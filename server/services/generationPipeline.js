const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { readJson, writeJson } = require('./storage');
const { orchestrateDesignWithN8n, upsertTemplateMemory } = require('./integrations');

const TEMPLATE_MEMORY_FILE = path.join(__dirname, '../template-memory.json');

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function countInputs(urls, files) {
  return asArray(urls).length + asArray(files).length;
}

function getCanvasSize(designType) {
  if (designType === 'LinkedIn Carousel') return { width: 1080, height: 1080 };
  if (designType === 'Event Flyer') return { width: 1080, height: 1350 };
  if (designType === 'Twitter Banner') return { width: 1500, height: 500 };
  return { width: 1280, height: 720 };
}

function classifyDesignIntent({ designType, userCopyTexts, referenceImageUrls, referenceImageFiles, userAssetUrls, userAssetFiles }) {
  const referenceCount = countInputs(referenceImageUrls, referenceImageFiles);
  const assetCount = countInputs(userAssetUrls, userAssetFiles);
  const copyCount = asArray(userCopyTexts).length;
  const typeSuggestsCarousel = /carousel/i.test(designType || '');

  // Critical fix: multiple related input images do not automatically mean multiple output slides.
  // For a YouTube thumbnail, many asset images are composited into ONE thumbnail unless the user selected a carousel format.
  const isCarousel = typeSuggestsCarousel;
  const slideCount = isCarousel ? Math.max(copyCount, assetCount, referenceCount, 1) : 1;

  return {
    mode: isCarousel ? 'carousel' : 'single',
    isCarousel,
    slideCount,
    referenceCount,
    assetCount,
    copyCount,
    confidence: typeSuggestsCarousel ? 0.94 : 0.91,
    reason: isCarousel
      ? 'Selected design type is a carousel/post sequence, so related images are mapped across slides.'
      : 'Selected design type is a single-output format, so related images are composited into one design.'
  };
}

function getStylePreset(designType, referenceCount, brandPalette) {
  const palette = brandPalette && brandPalette.length >= 3 ? brandPalette : ['#0f172a', '#b11226', '#f8fafc', '#ffffff'];
  const base = {
    styleId: 'deterministic-template-v1',
    source: referenceCount > 0 ? 'reference-image-guided-local-schema' : 'local-default-schema',
    palette,
    typographyRule: 'Render supplied copy exactly as provided. Do not rewrite, abbreviate, or invent hook text.',
    fidelityRule: 'Preserve the selected format and compose all supplied assets into the intended design unless the selected format is carousel.'
  };

  if (designType === 'YouTube Thumbnail') {
    return {
      ...base,
      name: 'YouTube reference-composite thumbnail',
      visualDNA: 'single 16:9 canvas, reference-led background treatment, supplied assets composited as subjects, bold supplied headline treatment',
      background: { type: 'cinematic-gradient', vignette: true, texture: 'subtle-documentary-grain' },
      textTreatment: { color: palette[3] || '#ffffff', stroke: '#050505', accent: palette[1] || '#b11226', case: 'preserve-supplied' }
    };
  }

  if (designType === 'LinkedIn Carousel') {
    return {
      ...base,
      name: 'LinkedIn carousel sequence',
      visualDNA: 'related square slides with consistent palette, repeated structural rhythm, and slide-specific supplied text',
      background: { type: 'brand-gradient-card', vignette: false, texture: 'soft-grid' },
      textTreatment: { color: '#ffffff', stroke: '#111827', accent: palette[1] || '#6366f1', case: 'preserve-supplied' }
    };
  }

  return {
    ...base,
    name: `${designType} generated layout`,
    visualDNA: 'format-specific canvas with supplied assets and exact supplied copy',
    background: { type: 'format-gradient', vignette: true, texture: 'soft-grid' },
    textTreatment: { color: '#ffffff', stroke: '#111827', accent: palette[1] || '#6366f1', case: 'preserve-supplied' }
  };
}

function buildAssetPlacements(designType, assetSources, canvasSize, slideIndex, isCarousel) {
  if (assetSources.length === 0) return [];

  if (designType === 'YouTube Thumbnail' && !isCarousel) {
    const slots = assetSources.length === 1
      ? [{ x: 760, y: 82, width: 410, height: 560, borderRadius: 24 }]
      : assetSources.length === 2
        ? [
            { x: 668, y: 82, width: 292, height: 560, borderRadius: 22 },
            { x: 958, y: 82, width: 292, height: 560, borderRadius: 22 }
          ]
        : assetSources.map((_, idx) => ({ x: 620 + idx * 190, y: 110, width: 210, height: 500, borderRadius: 18 }));
    return assetSources.map((source, index) => ({ id: `asset_${index + 1}`, source, ...slots[index % slots.length], fit: 'cover', role: index === 0 ? 'primary-subject' : 'supporting-subject' }));
  }

  const source = isCarousel ? assetSources[slideIndex % assetSources.length] : assetSources[0];
  if (designType === 'LinkedIn Carousel') {
    const right = slideIndex % 2 === 0;
    return [{ id: `asset_${slideIndex + 1}`, source, x: right ? 590 : 90, y: 255, width: 400, height: 520, borderRadius: 32, fit: 'cover', role: 'slide-subject' }];
  }
  if (designType === 'Twitter Banner') {
    return [{ id: 'asset_1', source, x: 1010, y: 70, width: 360, height: 360, borderRadius: 180, fit: 'cover', role: 'banner-subject' }];
  }
  return [{ id: 'asset_1', source, x: 160, y: 470, width: canvasSize.width - 320, height: canvasSize.height - 600, borderRadius: 24, fit: 'cover', role: 'main-visual' }];
}

function buildTextLayer(designType, copy, canvasSize, style, isCarousel, assetCount) {
  if (designType === 'YouTube Thumbnail' && !isCarousel) {
    return {
      id: 'headline', text: copy, x: 72, y: canvasSize.height * 0.5, maxWidth: assetCount > 0 ? 560 : 1040,
      fontSize: copy.length <= 18 ? 82 : 64, fontWeight: '900', fontFamily: 'Outfit, Inter, sans-serif',
      color: style.textTreatment.color, stroke: style.textTreatment.stroke, strokeWidth: 8, align: 'left', lineHeight: copy.length <= 18 ? 92 : 74,
      treatment: 'oversized high-contrast supplied headline'
    };
  }

  if (designType === 'LinkedIn Carousel') {
    return {
      id: 'headline', text: copy, x: canvasSize.width / 2, y: 160, maxWidth: 880,
      fontSize: 58, fontWeight: '900', fontFamily: 'Inter, Outfit, sans-serif', color: '#ffffff', stroke: '#111827', strokeWidth: 4,
      align: 'center', lineHeight: 70, treatment: 'consistent carousel headline'
    };
  }

  return {
    id: 'headline', text: copy, x: 120, y: canvasSize.height * 0.28, maxWidth: canvasSize.width - 240,
    fontSize: 62, fontWeight: '900', fontFamily: 'Outfit, Inter, sans-serif', color: '#ffffff', stroke: '#111827', strokeWidth: 5,
    align: 'left', lineHeight: 76, treatment: 'format headline'
  };
}

function normalizeSources(files, urls) {
  return [...asArray(files), ...asArray(urls)];
}

async function maybeCallGeminiImageGeneration({ prompt = null, designType = 'Design' } = {}) {
  if (process.env.ENABLE_REAL_IMAGE_GENERATION !== 'true') {
    return { attempted: false, ok: false, provider: 'gemini', reason: 'disabled-to-protect-budget' };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { attempted: false, ok: false, provider: 'gemini', reason: 'GEMINI_API_KEY missing' };
  }
  const cap = parseInt(process.env.GEMINI_DAILY_CAP || '10', 10);
  const trackerFile = path.join(__dirname, '../logs', 'gemini_daily_calls.json');
  const today = new Date().toISOString().split('T')[0];
  let tracker = {};
  try { if (fs.existsSync(trackerFile)) tracker = JSON.parse(fs.readFileSync(trackerFile, 'utf8')); } catch (e) {}
  const callsToday = (tracker[today] || 0);
  if (callsToday >= cap) {
    return { attempted: false, ok: false, provider: 'gemini', reason: `daily-cap-reached (${callsToday}/${cap})` };
  }
  try {
    const payload = {
      contents: [{ parts: [{ text: prompt || `Generate a ${designType} image` }] }],
      generationConfig: { responseMimeType: 'image/png' }
    };
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await resp.text();
    let data = null;
    try { data = JSON.parse(body); } catch (e) { data = { raw: body }; }
    if (!resp.ok) {
      return { attempted: true, ok: false, provider: 'gemini', status: resp.status, reason: data.error?.message || JSON.stringify(data) };
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);
    if (!imagePart) {
      return { attempted: true, ok: false, provider: 'gemini', reason: 'no-image-in-response' };
    }
    const b64 = imagePart.inlineData.data;
    const outName = `gemini_${Date.now()}.png`;
    const outPath = path.join(__dirname, '../generated_images', outName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    tracker[today] = (tracker[today] || 0) + 1;
    fs.writeFileSync(trackerFile, JSON.stringify(tracker, null, 2));
    return { attempted: true, ok: true, provider: 'gemini', imageUrl: `/generated_images/${outName}`, localPath: outPath, callsToday: tracker[today] };
  } catch (e) {
    return { attempted: true, ok: false, provider: 'gemini', reason: e.message || 'exception' };
  }
}

async function generateDesignSchema(input, user) {
  const referenceSources = normalizeSources(input.referenceImageFiles, input.referenceImageUrls);
  const assetSources = normalizeSources(input.userAssetFiles, input.userAssetUrls);
  const copies = asArray(input.userCopyTexts);
  const localIntent = classifyDesignIntent(input);
  const templateId = input.templateId || makeId('tpl');

  const orchestrationPayload = {
    event: 'design_generation_request',
    templateId,
    designType: input.designType,
    userCopyTexts: copies,
    caption: copies[0] || '',
    referenceImageUrls: asArray(input.referenceImageUrls),
    referenceImageFiles: asArray(input.referenceImageFiles),
    userAssetUrls: asArray(input.userAssetUrls),
    userAssetFiles: asArray(input.userAssetFiles),
    referenceCount: referenceSources.length,
    assetCount: assetSources.length,
    requestedSlides: localIntent.slideCount,
    localIntent
  };
  const n8nOrchestration = await orchestrateDesignWithN8n(orchestrationPayload);
  if (process.env.REQUIRE_N8N_ORCHESTRATION === 'true' && !n8nOrchestration.ok) {
    throw new Error(`n8n/Flowise orchestration failed: ${n8nOrchestration.error || n8nOrchestration.status || 'unknown error'}`);
  }

  const flowiseRules = n8nOrchestration.flowise || {};
  const intent = {
    ...localIntent,
    mode: flowiseRules.mode || localIntent.mode,
    isCarousel: (flowiseRules.mode || localIntent.mode) === 'carousel',
    slideCount: Number(flowiseRules.slideCount || localIntent.slideCount),
    orchestrationSource: n8nOrchestration.source,
    flowiseChatflowId: flowiseRules.chatflowId || null
  };
  const canvasSize = getCanvasSize(input.designType);
  const style = {
    ...getStylePreset(input.designType, intent.referenceCount, input.brandPalette),
    orchestrationRules: flowiseRules.layoutRules || null
  };

  const slides = Array.from({ length: intent.slideCount }, (_, slideIndex) => {
    const copy = copies[slideIndex] || copies[0] || '';
    const assets = buildAssetPlacements(input.designType, assetSources, canvasSize, slideIndex, intent.isCarousel);
    const textLayer = buildTextLayer(input.designType, copy, canvasSize, style, intent.isCarousel, assetSources.length);
    return {
      slideIndex,
      userCopyText: copy,
      userAssetFile: assets[0]?.source || null,
      userAssetUrl: null,
      assets,
      textLayers: [textLayer],
      backgroundLayer: style.background,
      layoutSchema: {
        type: input.designType,
        canvasSize,
        palette: style.palette,
        textConfig: textLayer,
        assetConfig: assets[0] || { x: 0, y: 0, width: 0, height: 0, borderRadius: 0 },
        assets,
        style
      }
    };
  });

  const design = {
    id: makeId('dsg'),
    userId: user.id,
    designType: input.designType,
    userCopyText: copies.join(' | '),
    mode: intent.mode,
    intent,
    slides,
    templateId,
    styleGuide: style,
    generation: {
      strategy: n8nOrchestration.ok ? 'n8n-flowise-orchestrated-schema-render' : 'api-first-deterministic-schema-render',
      realImageGeneration: await maybeCallGeminiImageGeneration(),
      warnings: n8nOrchestration.ok ? [] : ['n8n/Flowise orchestration was unavailable; local deterministic renderer handled the request.'],
      integrations: {}
    },
    createdAt: new Date().toISOString()
  };

  const templateMemory = {
    templateId,
    designType: input.designType,
    mode: intent.mode,
    summary: `${style.name}: ${style.visualDNA}. ${intent.reason}`,
    style,
    createdAt: design.createdAt
  };

  const memory = readJson(TEMPLATE_MEMORY_FILE, []);
  memory.push(templateMemory);
  writeJson(TEMPLATE_MEMORY_FILE, memory.slice(-250));

  const pinecone = await upsertTemplateMemory(templateMemory);

  design.generation.integrations = {
    pinecone,
    n8n: n8nOrchestration,
    flowise: {
      attempted: true,
      ok: Boolean(n8nOrchestration.flowise?.source === 'flowise-chatflow'),
      response: n8nOrchestration.flowise || null,
      chatflowId: n8nOrchestration.flowise?.chatflowId || null
    }
  };
  return design;
}

module.exports = { classifyDesignIntent, generateDesignSchema, getCanvasSize };
