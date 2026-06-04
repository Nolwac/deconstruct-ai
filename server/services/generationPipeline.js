const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
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

function classifyDesignIntent({ designType, generationMode, userCopyTexts, referenceImageUrls, referenceImageFiles, userAssetUrls, userAssetFiles }) {
  const referenceCount = countInputs(referenceImageUrls, referenceImageFiles);
  const assetCount = countInputs(userAssetUrls, userAssetFiles);
  const copyCount = asArray(userCopyTexts).length;
  const userSelectedCarousel = generationMode === 'carousel';
  const typeSuggestsCarousel = /carousel/i.test(designType || '');

  // Multiple related input images do not automatically mean multiple output slides.
  // The explicit user selector is authoritative; format names that contain carousel remain a sensible default.
  const isCarousel = userSelectedCarousel || typeSuggestsCarousel;
  const slideCount = isCarousel ? Math.max(copyCount, assetCount, referenceCount, 1) : 1;

  return {
    mode: isCarousel ? 'carousel' : 'single',
    isCarousel,
    slideCount,
    referenceCount,
    assetCount,
    copyCount,
    confidence: isCarousel ? 0.96 : 0.92,
    reason: isCarousel
      ? 'Selected design type is a carousel/post sequence, so related images are mapped across slides.'
      : 'Selected design type is a single-output format, so related images are composited into one design.'
  };
}

function getStylePreset(designType, referenceCount, brandPalette) {
  const palette = brandPalette && brandPalette.length >= 3 ? brandPalette : ['#0f172a', '#b11226', '#f8fafc', '#ffffff'];
  const base = {
    styleId: 'workflow-template-memory-v1',
    source: referenceCount > 0 ? 'reference-image-guided-workflow-schema' : 'workflow-default-schema',
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

function saveN8nGeneratedImage(image, designId, slideIndex) {
  if (!image?.data || !image?.mimeType?.startsWith('image/')) return null;
  const ext = image.mimeType.includes('jpeg') || image.mimeType.includes('jpg') ? 'jpg' : 'png';
  const outName = `${designId}_slide_${slideIndex + 1}.${ext}`;
  const outDir = path.join(__dirname, '../generated_images');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName);
  fs.writeFileSync(outPath, Buffer.from(image.data, 'base64'));
  return { imageUrl: `/generated_images/${outName}`, localPath: outPath, mimeType: image.mimeType };
}

async function loadImageSourceBuffer(source) {
  if (!source || typeof source !== 'string') return null;
  const dataUrlMatch = source.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) return Buffer.from(dataUrlMatch[2], 'base64');
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Asset fetch failed with status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (fs.existsSync(source)) return fs.readFileSync(source);
  return null;
}

async function enforceAssetVisibilityOnImage({ imagePath, assetSource, slideIndex }) {
  const assetBuffer = await loadImageSourceBuffer(assetSource);
  if (!assetBuffer) return null;

  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width || 1280;
  const height = metadata.height || 720;
  const isWide = width >= height;
  const panelWidth = Math.round(width * (isWide ? 0.34 : 0.46));
  const panelHeight = Math.round(height * (isWide ? 0.68 : 0.42));
  const padding = Math.max(14, Math.round(Math.min(width, height) * 0.025));
  const x = slideIndex % 2 === 0 ? width - panelWidth - padding * 2 : padding * 2;
  const y = Math.round((height - panelHeight) / 2);
  const radius = Math.round(Math.min(panelWidth, panelHeight) * 0.06);

  const panelSvg = Buffer.from(`
    <svg width="${panelWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${panelWidth}" height="${panelHeight}" rx="${radius}" fill="rgba(255,255,255,0.94)"/>
      <rect x="5" y="5" width="${panelWidth - 10}" height="${panelHeight - 10}" rx="${Math.max(0, radius - 4)}" fill="none" stroke="rgba(15,23,42,0.28)" stroke-width="6"/>
    </svg>
  `);

  const visibleAsset = await sharp(assetBuffer)
    .rotate()
    .resize({
      width: panelWidth - padding * 2,
      height: panelHeight - padding * 2,
      fit: 'cover',
      position: 'attention'
    })
    .jpeg({ quality: 92 })
    .toBuffer();

  const tempPath = `${imagePath}.asset-visible.tmp.jpg`;
  await sharp(imagePath)
    .composite([
      { input: panelSvg, left: x, top: y },
      { input: visibleAsset, left: x + padding, top: y + padding }
    ])
    .jpeg({ quality: 94 })
    .toFile(tempPath);
  fs.renameSync(tempPath, imagePath);
  return { enforced: true, x, y, width: panelWidth, height: panelHeight, strategy: 'foreground-asset-photo-card' };
}

function persistWorkflowInputImages(dataUrls, prefix) {
  const internalBaseUrl = (process.env.INTERNAL_APP_BASE_URL || 'http://app:5000').replace(/\/$/, '');
  const outDir = path.join(__dirname, '../generated_images/workflow_inputs');
  fs.mkdirSync(outDir, { recursive: true });
  return asArray(dataUrls).map((dataUrl, idx) => {
    if (typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1];
    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
    const outName = `${prefix}_${idx + 1}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const outPath = path.join(outDir, outName);
    fs.writeFileSync(outPath, Buffer.from(match[2], 'base64'));
    return `${internalBaseUrl}/generated_images/workflow_inputs/${outName}`;
  }).filter(Boolean);
}

function sanitizeN8nOrchestration(orchestration) {
  const response = orchestration.response || {};
  const gemini = response.gemini || {};
  return {
    attempted: orchestration.attempted,
    ok: orchestration.ok,
    status: orchestration.status,
    error: orchestration.error || null,
    source: orchestration.source,
    workflow: orchestration.workflow,
    evidence: orchestration.evidence || {},
    templateRuleQuality: response.templateRuleQuality || orchestration.evidence?.templateRuleQuality || null,
    flowise: orchestration.flowise || null,
    gemini: {
      attempted: Boolean(gemini.attempted),
      ok: Boolean(gemini.ok),
      model: gemini.model || null,
      conditioning: gemini.conditioning || null,
      assetImageCount: gemini.assetImageCount || gemini.conditioning?.assetImageCount || 0,
      image: gemini.image ? { mimeType: gemini.image.mimeType, saved: true } : null
    }
  };
}

async function generateDesignSchema(input, user) {
  const referenceSources = normalizeSources(input.referenceImageFiles, input.referenceImageUrls);
  const assetSources = normalizeSources(input.userAssetFiles, input.userAssetUrls);
  const copies = asArray(input.userCopyTexts);
  const localIntent = classifyDesignIntent(input);
  const memory = readJson(TEMPLATE_MEMORY_FILE, []);
  const requestedTemplateId = input.templateId || null;
  const existingTemplate = requestedTemplateId
    ? memory.find(item => item.templateId === requestedTemplateId && item.userId === user.id)
    : null;
  const templateMode = existingTemplate ? 'reuse-existing-template' : (referenceSources.length ? 'create-template-from-reference' : 'ad-hoc-generation');
  const templateId = requestedTemplateId || makeId('tpl');

  const persistedReferenceUrls = persistWorkflowInputImages(input.referenceImageFiles, `${templateId}_ref`);
  const persistedAssetUrls = persistWorkflowInputImages(input.userAssetFiles, `${templateId}_asset`);

  const workflowAssetUrls = [...asArray(input.userAssetUrls), ...persistedAssetUrls];
  const firstSlideAssetUrls = localIntent.isCarousel && workflowAssetUrls.length
    ? [workflowAssetUrls[0]]
    : workflowAssetUrls;

  const orchestrationPayload = {
    templateId,
    templateMode,
    existingTemplateRules: existingTemplate ? { summary: existingTemplate.summary, style: existingTemplate.style, mode: existingTemplate.mode } : null,
    designType: input.designType,
    generationMode: localIntent.mode,
    userCopyTexts: copies,
    caption: copies[0] || '',
    referenceImageUrls: [...asArray(input.referenceImageUrls), ...persistedReferenceUrls],
    referenceImageFiles: [],
    userAssetUrls: firstSlideAssetUrls,
    allUserAssetUrls: workflowAssetUrls,
    userAssetFiles: []
  };
  const hasWorkflowImage = (orchestration) => {
    const image = orchestration.response?.gemini?.image;
    return Boolean(orchestration.response?.gemini?.ok && image?.data && image?.mimeType?.startsWith('image/'));
  };

  const runWorkflowForPayload = async (payload, label = 'workflow') => {
    let orchestration = await orchestrateDesignWithN8n(payload);
    if (!orchestration.ok) {
      throw new Error(`n8n/Flowise/Gemini ${label} failed: ${orchestration.error || orchestration.status || 'unknown workflow error'}`);
    }
    if (!hasWorkflowImage(orchestration)) {
      orchestration = await orchestrateDesignWithN8n({
        ...payload,
        retryAttempt: 1,
        safeImageMode: true,
        retryInstructions: 'The previous Gemini image attempt returned no image. Regenerate as a stylized editorial design that visibly uses the supplied user asset images as the main subject/content, without face-matching, identifying, naming, impersonating, or exactly reproducing any real person. Preserve template rules, supplied text, colors, composition intent, and asset visibility.'
      });
      if (!orchestration.ok) {
        throw new Error(`n8n/Flowise/Gemini ${label} safe retry failed: ${orchestration.error || orchestration.status || 'unknown workflow error'}`);
      }
    }
    return orchestration;
  };

  let n8nOrchestration = await runWorkflowForPayload(orchestrationPayload, 'slide 1');

  const flowiseRules = n8nOrchestration.flowise || {};
  const templateRuleQuality = n8nOrchestration.response?.templateRuleQuality || null;
  const resolvedMode = input.generationMode === 'carousel' ? 'carousel' : (flowiseRules.mode || localIntent.mode);
  const flowiseSlideCount = Number(flowiseRules.slideCount || 0);
  const resolvedSlideCount = resolvedMode === 'carousel'
    ? Math.max(localIntent.slideCount, flowiseSlideCount, copies.length, assetSources.length, 2)
    : 1;
  const intent = {
    ...localIntent,
    mode: resolvedMode,
    isCarousel: resolvedMode === 'carousel',
    slideCount: resolvedSlideCount,
    orchestrationSource: n8nOrchestration.source,
    flowiseChatflowId: flowiseRules.chatflowId || null
  };
  const canvasSize = getCanvasSize(input.designType);
  const style = {
    ...(existingTemplate?.style || getStylePreset(input.designType, intent.referenceCount, input.brandPalette)),
    orchestrationRules: flowiseRules.layoutRules || existingTemplate?.style?.orchestrationRules || null,
    templateMode,
    templateSource: existingTemplate ? 'stored-template-memory' : (referenceSources.length ? 'reference-image-derived' : 'format-default')
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
      strategy: 'n8n-flowise-gemini-orchestrated-image',
      realImageGeneration: null,
      warnings: [],
      integrations: {},
      templateRuleQuality
    },
    createdAt: new Date().toISOString()
  };

  const generatedImages = [];
  const slideOrchestrations = [n8nOrchestration];
  const allAssetUrls = orchestrationPayload.allUserAssetUrls || orchestrationPayload.userAssetUrls || [];

  if (intent.isCarousel && slides.length > 1) {
    for (let slideIndex = 1; slideIndex < slides.length; slideIndex += 1) {
      const copy = copies[slideIndex] || copies[0] || '';
      const selectedAssetUrl = allAssetUrls.length ? allAssetUrls[slideIndex % allAssetUrls.length] : null;
      const slidePayload = {
        ...orchestrationPayload,
        caption: copy,
        userCopyTexts: [copy],
        userAssetUrls: selectedAssetUrl ? [selectedAssetUrl] : allAssetUrls
      };
      slideOrchestrations[slideIndex] = await runWorkflowForPayload(slidePayload, `slide ${slideIndex + 1}`);
    }
  }

  for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
    const orchestration = slideOrchestrations[slideIndex] || n8nOrchestration;
    const n8nImage = orchestration.response?.gemini?.image;
    if (!hasWorkflowImage(orchestration)) {
      throw new Error(`AI image workflow completed without returning a generated image for slide ${slideIndex + 1}.`);
    }
    let savedImage = null;
    try {
      savedImage = saveN8nGeneratedImage(n8nImage, design.id, slideIndex);
      const selectedAssetSource = intent.isCarousel
        ? assetSources[slideIndex % Math.max(assetSources.length, 1)]
        : assetSources[0];
      if (selectedAssetSource) {
        const assetVisibility = await enforceAssetVisibilityOnImage({
          imagePath: savedImage.localPath,
          assetSource: selectedAssetSource,
          slideIndex
        });
        if (assetVisibility?.enforced) {
          slides[slideIndex].assetVisibility = assetVisibility;
        }
      }
    } catch (error) {
      throw new Error(`Generated image for slide ${slideIndex + 1} could not be saved or asset-enforced: ${error.message}`);
    }
    slides[slideIndex].generatedImageUrl = savedImage.imageUrl;
    slides[slideIndex].generatedImageLocalPath = savedImage.localPath;
    slides[slideIndex].generatedImageMimeType = savedImage.mimeType;
    generatedImages.push(savedImage.imageUrl);
  }

  design.generation.realImageGeneration = {
    attempted: slideOrchestrations.every(orchestration => Boolean(orchestration.response?.gemini?.attempted)),
    ok: slideOrchestrations.every(orchestration => Boolean(orchestration.response?.gemini?.ok)) && generatedImages.length === slides.length,
    provider: 'gemini-via-n8n',
    model: n8nOrchestration.response?.gemini?.model || null,
    retryAttempt: Math.max(...slideOrchestrations.map(orchestration => orchestration.response?.gemini?.retryAttempt || 0)),
    assetVisibilityEnforced: slides.filter(slide => slide.assetVisibility?.enforced).length,
    generatedImages,
    slideCount: slides.length,
    generatedCount: generatedImages.length
  };

  const templateMemory = {
    templateId,
    userId: user.id,
    username: user.username,
    designType: input.designType,
    mode: intent.mode,
    summary: `${style.name}: ${style.visualDNA}. ${intent.reason}`,
    style,
    templateMode,
    source: templateMode === 'reuse-existing-template' ? 'existing-template' : (referenceSources.length ? 'reference-images' : 'default-format-rules'),
    referenceImageCount: referenceSources.length,
    assetImageCount: assetSources.length,
    createdAt: design.createdAt
  };

  if (templateMode !== 'reuse-existing-template') {
    try {
      memory.push(templateMemory);
      writeJson(TEMPLATE_MEMORY_FILE, memory.slice(-250));
    } catch (error) {
      design.generation.warnings.push(`Template memory save failed: ${error.message}`);
    }
  }

  let pinecone;
  try {
    pinecone = await upsertTemplateMemory(templateMemory);
  } catch (error) {
    pinecone = { attempted: true, ok: false, error: error.message };
    design.generation.warnings.push(`Pinecone memory sync failed; local generation still completed: ${error.message}`);
  }

  design.generation.integrations = {
    pinecone,
    n8n: sanitizeN8nOrchestration(n8nOrchestration),
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
