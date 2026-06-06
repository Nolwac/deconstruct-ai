const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { orchestrateDesignWithN8n, orchestrateTemplateRulesWithN8n } = require('./integrations');
const { assessTemplateRuleQuality, getTemplateForUser, getTemplateRules, upsertTemplate } = require('./templateRuleStore');

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function countInputs(urls, files) {
  return asArray(urls).length + asArray(files).length;
}

function classifyDesignIntent({ designType, generationMode, userCopyTexts, userAssetUrls, userAssetFiles }) {
  const assetCount = countInputs(userAssetUrls, userAssetFiles);
  const copyCount = asArray(userCopyTexts).length;
  const userSelectedCarousel = generationMode === 'carousel';
  const typeSuggestsCarousel = /carousel/i.test(designType || '');
  const isCarousel = userSelectedCarousel || typeSuggestsCarousel;
  const slideCount = isCarousel ? Math.max(copyCount, assetCount, 1) : 1;

  return {
    mode: isCarousel ? 'carousel' : 'single',
    isCarousel,
    slideCount,
    referenceCount: 0,
    assetCount,
    copyCount,
    confidence: isCarousel ? 0.96 : 0.92,
    reason: isCarousel
      ? 'Selected design type is a carousel/post sequence, so related assets are mapped across slides.'
      : 'Selected design type is a single-output format, so supplied assets are integrated by the AI into one final design.'
  };
}

function normalizeSources(files, urls) {
  return [...asArray(files), ...asArray(urls)];
}

function resolveImageCompositionSize(designType) {
  const normalized = String(designType || '').toLowerCase();
  if (/flyer|poster|story|portrait|vertical|4:5|9:16/.test(normalized)) return '1024x1536';
  if (/carousel|square|instagram|linkedin/.test(normalized)) return '1024x1024';
  if (/thumbnail|youtube|banner|twitter|x\s*banner|landscape|wide|16:9|3:1/.test(normalized)) return '1536x1024';
  return '1536x1024';
}

function parseImageSize(size) {
  const match = String(size || '').match(/^(\d+)x(\d+)$/);
  if (!match) return { width: 1536, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createPngDataUrl(width, height, paint) {
  const rowLength = (width * 4) + 1;
  const raw = Buffer.alloc(rowLength * height);
  const setPixel = (x, y, rgba) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * rowLength) + 1 + (x * 4);
    raw[offset] = rgba[0];
    raw[offset + 1] = rgba[1];
    raw[offset + 2] = rgba[2];
    raw[offset + 3] = rgba[3];
  };
  const fillRect = (x, y, w, h, rgba) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + w));
    const y1 = Math.min(height, Math.ceil(y + h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) setPixel(px, py, rgba);
    }
  };
  for (let y = 0; y < height; y += 1) raw[y * rowLength] = 0;
  paint({ fillRect, width, height });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND')
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function createTransparentPngDataUrl(width, height) {
  return createPngDataUrl(width, height, ({ fillRect }) => fillRect(0, 0, width, height, [255, 255, 255, 0]));
}

function createLayoutControlCanvasDataUrl(width, height) {
  const isLandscape = width > height;
  return createPngDataUrl(width, height, ({ fillRect }) => {
    fillRect(0, 0, width, height, [8, 9, 13, 255]);
    fillRect(width * 0.04, height * 0.07, width * 0.48, height * 0.06, [239, 35, 60, 255]);
    fillRect(width * 0.04, height * 0.18, isLandscape ? width * 0.46 : width * 0.88, height * 0.18, [255, 255, 255, 255]);
    fillRect(width * 0.04, height * 0.39, isLandscape ? width * 0.38 : width * 0.78, height * 0.08, [255, 207, 38, 255]);
    const imageX = isLandscape ? width * 0.57 : width * 0.12;
    const imageY = isLandscape ? height * 0.12 : height * 0.52;
    const imageW = isLandscape ? width * 0.36 : width * 0.76;
    const imageH = isLandscape ? height * 0.76 : height * 0.38;
    fillRect(imageX - width * 0.015, imageY - height * 0.015, imageW + width * 0.03, imageH + height * 0.03, [255, 207, 38, 255]);
    fillRect(imageX, imageY, imageW, imageH, [31, 41, 55, 255]);
    fillRect(width * 0.04, height * 0.88, width * 0.72, Math.max(8, height * 0.02), [239, 35, 60, 255]);
  });
}

function buildImageEditCanvasPayloads(outputImageSize) {
  const { width, height } = parseImageSize(outputImageSize);
  return [
    {
      fieldName: 'base_canvas',
      dataUrl: createLayoutControlCanvasDataUrl(width, height),
      filename: `layout_control_canvas_${width}x${height}.png`,
      source: 'layout-control-canvas'
    },
    {
      fieldName: 'edit_mask',
      dataUrl: createTransparentPngDataUrl(width, height),
      filename: `edit_mask_${width}x${height}.png`,
      source: 'full-transparent-edit-mask'
    }
  ];
}

function sanitizeTemplateRulesForImagePrompt(ruleText) {
  return String(ruleText || '')
    // Template examples often contain sensational sample copy. The provider prompt only
    // needs style/layout rules; actual rendered copy comes from the user's caption.
    .replace(/\bALMOST\s+ENDED\s+HIM\b/gi, 'KEY EMPHASIS WORDS')
    .replace(/\bENDED\s+HIM\b/gi, 'CHANGED EVERYTHING')
    .replace(/\bTHE\s+TRUTH\s+THAT\b/gi, 'MAIN HEADLINE TEXT')
    .replace(/\bBEFORE\s+THE\s+LEGEND\s+BEGAN\b/gi, 'SUPPORTING SUBHEADLINE')
    .replace(/\b(killed|murdered|suicide|death|dead|blood|weapon)\b/gi, 'dramatic')
    .trim();
}

function buildImageCompositionPrompt({ templateId, templateRuleText, designType, generationMode, caption, outputImageSize, assetCount }) {
  const assetFields = Array.from({ length: assetCount }, (_, index) => `asset_${index + 1}`);
  const safeTemplateRuleText = sanitizeTemplateRulesForImagePrompt(templateRuleText);
  const normalizedType = String(designType || 'design').toLowerCase();
  const isLandscape = /thumbnail|youtube|banner|twitter|x\s*banner|landscape|wide|16:9|3:1/.test(normalizedType);
  const isCarousel = /carousel|linkedin|instagram|square/.test(normalizedType) || generationMode === 'carousel';
  const layoutInstruction = isLandscape
    ? 'Create a finished landscape social graphic with clear headline typography, a composed subject area, background treatment, contrast, accents, and strong hierarchy.'
    : isCarousel
      ? 'Create a finished square social card with clear headline typography, a composed subject area, background treatment, accents, spacing, and hierarchy.'
      : 'Create a finished poster/flyer with headline typography, a composed subject area, background treatment, spacing, and hierarchy.';

  return [
    'Create a safe original social graphic using the uploaded layout canvas as a loose composition guide.',
    layoutInstruction,
    `Render this exact final headline/caption text: ${caption || ''}`,
    'Use a dark high-contrast YouTube-thumbnail style if the selected template resembles that layout: bold condensed typography, strong left/right composition, yellow/white/red accents, textured background, and readable mobile-scale headline.',
    `Uploaded asset fields: ${assetFields.join(', ') || 'none'}.`,
    'Use uploaded asset images only as broad visual reference for pose, lighting, crop, and subject placement. Create an original generic subject; do not recreate, identify, or preserve the exact likeness of any real person from an uploaded image.',
    'Produce one polished final graphic image. Keep the caption legible and prominent.',
    `Design type: ${designType || 'design'}`,
    `Generation mode: ${generationMode || 'single'}`,
    `Output size: ${outputImageSize}`,
    `Template rule id: ${templateId}`
  ].join('\n');
}

function dataUrlMimeType(dataUrl) {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;]+);base64,/) : null;
  return match ? match[1] : null;
}

function fileExtFromMime(mimeType) {
  if (/jpe?g/i.test(mimeType || '')) return 'jpg';
  if (/webp/i.test(mimeType || '')) return 'webp';
  return 'png';
}

async function fetchUrlAsDataUrl(url, index) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error(`Asset URL ${index + 1} is not an HTTP(S) URL.`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      throw new Error(`content-type ${contentType || 'unknown'} is not an image`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('downloaded image is empty');
    return {
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
      filename: `asset_${index + 1}.${fileExtFromMime(contentType)}`,
      sourceUrl: url
    };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timeout' : error.message;
    throw new Error(`Asset URL ${index + 1} could not be prepared for image conditioning: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function buildBinaryAssetPayloads(files, urls) {
  const fileAssets = asArray(files).map((dataUrl, index) => {
    const mimeType = dataUrlMimeType(dataUrl);
    if (!mimeType?.startsWith('image/')) return null;
    return {
      dataUrl,
      filename: `asset_${index + 1}.${fileExtFromMime(mimeType)}`,
      source: 'uploaded-file'
    };
  }).filter(Boolean);
  const urlAssets = [];
  for (const [index, url] of asArray(urls).entries()) {
    urlAssets.push(await fetchUrlAsDataUrl(url, fileAssets.length + index));
  }
  const assets = [...urlAssets, ...fileAssets].slice(0, 16);
  if (!assets.length) {
    throw new Error('Asset image upload could not be prepared as n8n binary input.');
  }
  return assets;
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

function getInternalAppBaseUrl() {
  return (process.env.INTERNAL_APP_BASE_URL || 'http://app:5000').replace(/\/$/, '');
}

function persistWorkflowInputImages(dataUrls, prefix) {
  const internalBaseUrl = getInternalAppBaseUrl();
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

function getN8nImageProviderResponse(orchestration) {
  const response = orchestration.response || {};
  return response.openai || response.gemini || {};
}

function getN8nImageProviderName(orchestration) {
  const response = orchestration.response || {};
  if (response.openai) return 'openai';
  if (response.gemini) return 'gemini';
  return 'unknown';
}

function sanitizeN8nOrchestration(orchestration) {
  const response = orchestration.response || {};
  const provider = getN8nImageProviderResponse(orchestration);
  const providerName = getN8nImageProviderName(orchestration);
  return {
    attempted: orchestration.attempted,
    ok: orchestration.ok,
    status: orchestration.status,
    error: orchestration.error || null,
    source: orchestration.source,
    workflow: orchestration.workflow,
    evidence: orchestration.evidence || {},
    templateRuleQuality: response.templateRuleQuality || orchestration.evidence?.templateRuleQuality || null,
    provider: providerName,
    [providerName]: {
      attempted: Boolean(provider.attempted),
      ok: Boolean(provider.ok),
      model: provider.model || null,
      conditioning: provider.conditioning || null,
      assetImageCount: provider.assetImageCount || provider.conditioning?.assetImageCount || 0,
      image: provider.image ? { mimeType: provider.image.mimeType, saved: true } : null
    }
  };
}

async function createTemplateRuleSchema(input, user) {
  const referenceSources = normalizeSources(input.referenceImageFiles, input.referenceImageUrls);
  if (!referenceSources.length) {
    throw new Error('A real reference design image is required to create template rules.');
  }

  const templateId = input.templateId || makeId('tpl');
  const persistedReferenceUrls = persistWorkflowInputImages(input.referenceImageFiles, `${templateId}_ref`);
  const workflowReferenceUrls = [...asArray(input.referenceImageUrls), ...persistedReferenceUrls];
  if (!workflowReferenceUrls.length) {
    throw new Error('Reference image upload could not be prepared for template-rule creation.');
  }

  const orchestration = await orchestrateTemplateRulesWithN8n({
    templateId,
    designType: input.designType,
    generationMode: input.generationMode || 'single',
    referenceImageUrls: workflowReferenceUrls,
    referenceImageFiles: []
  });

  if (!orchestration.ok) {
    throw new Error(`Template-rule creation failed: ${orchestration.error || orchestration.status || 'unknown workflow error'}`);
  }

  const ruleText = (orchestration.response?.templateRuleText || orchestration.response?.ruleText || '').trim();
  if (!ruleText) {
    throw new Error('Template-rule creation completed without returning rule text.');
  }

  const quality = assessTemplateRuleQuality(ruleText);
  const templateMemory = {
    templateId,
    userId: user.id,
    username: user.username,
    designType: input.designType || 'Design Template',
    mode: input.generationMode || 'single',
    summary: `${input.designType || 'Design'} template rules created from reference image.`,
    ruleText,
    templateMode: 'create-template-from-reference',
    source: 'reference-image-gemini-vision',
    referenceImageCount: referenceSources.length,
    assetImageCount: 0,
    createdAt: new Date().toISOString()
  };

  const templateStore = await upsertTemplate(templateMemory);
  if (!templateStore.ok) {
    throw new Error(`Template-rule storage failed: ${templateStore.error || 'PostgreSQL write failed'}`);
  }

  return {
    template: {
      ...templateMemory,
      ruleText,
      templateRuleQuality: quality
    },
    generation: {
      templateStore,
      n8n: {
        attempted: orchestration.attempted,
        ok: orchestration.ok,
        source: orchestration.source,
        workflow: orchestration.workflow,
        evidence: orchestration.evidence || {}
      },
      templateRuleQuality: quality
    }
  };
}

async function generateDesignSchema(input, user) {
  const assetSources = normalizeSources(input.userAssetFiles, input.userAssetUrls);
  const copies = asArray(input.userCopyTexts);
  const requestedTemplateId = input.templateId || null;
  if (!requestedTemplateId) {
    throw new Error('Select a saved template rule before generating a design.');
  }
  if (!assetSources.length) {
    throw new Error('A real asset image is required for design generation.');
  }

  const existingTemplateLookup = await getTemplateForUser(requestedTemplateId, user.id);
  const existingTemplate = existingTemplateLookup.template;
  if (!existingTemplate) {
    throw new Error(`Template rule ${requestedTemplateId} was not found for this user.`);
  }
  const existingTemplateRules = getTemplateRules(existingTemplate);
  if (!existingTemplateRules) {
    throw new Error(`Template rule ${requestedTemplateId} has no rule text.`);
  }

  const localIntent = classifyDesignIntent(input);
  const outputImageSize = resolveImageCompositionSize(input.designType || existingTemplate.designType);
  const persistedAssetUrls = persistWorkflowInputImages(input.userAssetFiles, `${requestedTemplateId}_asset`);
  const workflowAssetUrls = [...asArray(input.userAssetUrls), ...persistedAssetUrls];
  const binaryAssetPayloads = await buildBinaryAssetPayloads(input.userAssetFiles, input.userAssetUrls);
  if (!workflowAssetUrls.length && !binaryAssetPayloads.length) {
    throw new Error('Asset image upload could not be prepared for design generation.');
  }

  const firstSlideAssetUrls = workflowAssetUrls;
  const firstSlideBinaryAssets = binaryAssetPayloads;
  const editCanvasPayloads = buildImageEditCanvasPayloads(outputImageSize);

  const orchestrationPayload = {
    templateId: requestedTemplateId,
    templateMode: 'reuse-existing-template',
    existingTemplateRules,
    templateRuleText: existingTemplateRules,
    existingTemplateRuleQuality: assessTemplateRuleQuality(existingTemplateRules),
    designType: input.designType || existingTemplate.designType,
    generationMode: localIntent.mode,
    userCopyTexts: copies,
    caption: copies[0] || '',
    outputImageSize,
    requestedImageModel: 'models/gemini-3.1-flash-image',
    imagePrompt: buildImageCompositionPrompt({
      templateId: requestedTemplateId,
      templateRuleText: existingTemplateRules,
      designType: input.designType || existingTemplate.designType,
      generationMode: localIntent.mode,
      caption: copies[0] || '',
      outputImageSize,
      assetCount: firstSlideBinaryAssets.length
    }),
    referenceImageUrls: [],
    referenceImageFiles: [],
    userAssetUrls: firstSlideAssetUrls,
    allUserAssetUrls: workflowAssetUrls,
    userAssetFiles: [],
    __n8nBinaryAssets: [...editCanvasPayloads, ...firstSlideBinaryAssets]
  };

  const hasWorkflowImage = (orchestration) => {
    const provider = getN8nImageProviderResponse(orchestration);
    const image = provider.image;
    return Boolean(provider.ok && image?.data && image?.mimeType?.startsWith('image/'));
  };

  const runWorkflowForPayload = async (payload, label = 'workflow') => {
    const orchestration = await orchestrateDesignWithN8n(payload);
    if (!orchestration.ok) {
      throw new Error(`native n8n image ${label} failed: ${orchestration.error || orchestration.status || 'unknown workflow error'}`);
    }
    if (!hasWorkflowImage(orchestration)) {
      throw new Error(`native n8n image ${label} completed without returning a generated image.`);
    }
    return orchestration;
  };

  let n8nOrchestration = await runWorkflowForPayload(orchestrationPayload, 'slide 1');
  const finalTemplateRuleQuality = assessTemplateRuleQuality(existingTemplateRules);
  const resolvedMode = localIntent.mode;
  const resolvedSlideCount = resolvedMode === 'carousel'
    ? Math.max(localIntent.slideCount, copies.length, assetSources.length, 2)
    : 1;
  const intent = {
    ...localIntent,
    mode: resolvedMode,
    isCarousel: resolvedMode === 'carousel',
    slideCount: resolvedSlideCount,
    orchestrationSource: n8nOrchestration.source,
    flowiseChatflowId: null
  };
  const styleGuide = {
    source: `postgres-template-id:${existingTemplateLookup.source}`,
    templateMode: 'reuse-existing-template',
    aiTemplateRules: existingTemplateRules,
    templateRuleQuality: finalTemplateRuleQuality,
    retrieval: {
      strategy: 'template-id-exact-match',
      templateId: requestedTemplateId,
      store: existingTemplateLookup.source,
      vectorSearchUsed: false
    }
  };

  const slides = Array.from({ length: intent.slideCount }, (_, slideIndex) => {
    const copy = copies[slideIndex] || copies[0] || '';
    const selectedAssetSource = assetSources.length ? assetSources[slideIndex % assetSources.length] : null;
    return {
      slideIndex,
      userCopyText: copy,
      userAssetFile: selectedAssetSource,
      userAssetUrl: null
    };
  });

  const design = {
    id: makeId('dsg'),
    userId: user.id,
    designType: input.designType || existingTemplate.designType,
    userCopyText: copies.join(' | '),
    mode: intent.mode,
    intent,
    slides,
    templateId: requestedTemplateId,
    styleGuide,
    generation: {
      strategy: 'n8n-native-gemini-template-id-plus-assets',
      realImageGeneration: null,
      warnings: [],
      integrations: {},
      templateRuleQuality: finalTemplateRuleQuality
    },
    createdAt: new Date().toISOString()
  };

  const generatedImages = [];
  const slideOrchestrations = [n8nOrchestration];
  const allAssetUrls = orchestrationPayload.allUserAssetUrls || orchestrationPayload.userAssetUrls || [];

  if (intent.isCarousel && slides.length > 1) {
    for (let slideIndex = 1; slideIndex < slides.length; slideIndex += 1) {
      const copy = copies[slideIndex] || copies[0] || '';
      const slidePayload = {
        ...orchestrationPayload,
        caption: copy,
        userCopyTexts: [copy],
        imagePrompt: buildImageCompositionPrompt({
          templateId: requestedTemplateId,
          templateRuleText: existingTemplateRules,
          designType: input.designType || existingTemplate.designType,
          generationMode: localIntent.mode,
          caption: copy,
          outputImageSize,
          assetCount: binaryAssetPayloads.length
        }),
        userAssetUrls: allAssetUrls,
        __n8nBinaryAssets: [...editCanvasPayloads, ...binaryAssetPayloads]
      };
      if (!binaryAssetPayloads.length) {
        throw new Error(`No real asset image available for slide ${slideIndex + 1}.`);
      }
      slideOrchestrations[slideIndex] = await runWorkflowForPayload(slidePayload, `slide ${slideIndex + 1}`);
    }
  }

  for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
    const orchestration = slideOrchestrations[slideIndex] || n8nOrchestration;
    const n8nImage = getN8nImageProviderResponse(orchestration).image;
    if (!hasWorkflowImage(orchestration)) {
      throw new Error(`AI image workflow completed without returning a generated image for slide ${slideIndex + 1}.`);
    }
    let savedImage = null;
    try {
      savedImage = saveN8nGeneratedImage(n8nImage, design.id, slideIndex);
    } catch (error) {
      throw new Error(`Generated image for slide ${slideIndex + 1} could not be saved: ${error.message}`);
    }
    slides[slideIndex].generatedImageUrl = savedImage.imageUrl;
    slides[slideIndex].generatedImageLocalPath = savedImage.localPath;
    slides[slideIndex].generatedImageMimeType = savedImage.mimeType;
    generatedImages.push(savedImage.imageUrl);
  }

  design.generation.realImageGeneration = {
    attempted: slideOrchestrations.every(orchestration => Boolean(getN8nImageProviderResponse(orchestration).attempted)),
    ok: slideOrchestrations.every(orchestration => Boolean(getN8nImageProviderResponse(orchestration).ok)) && generatedImages.length === slides.length,
    provider: `${getN8nImageProviderName(n8nOrchestration)}-via-n8n`,
    model: getN8nImageProviderResponse(n8nOrchestration).model || null,
    outputImageSize,
    retryAttempt: 0,
    generatedImages,
    slideCount: slides.length,
    generatedCount: generatedImages.length
  };

  design.generation.integrations = {
    templateStore: { attempted: false, ok: true, source: existingTemplateLookup.source, templateId: requestedTemplateId, reason: 'Used exact stored template rules by id.' },
    n8n: sanitizeN8nOrchestration(n8nOrchestration),
    flowise: { attempted: false, ok: true, bypassed: true, response: null, chatflowId: null }
  };

  return design;
}

module.exports = { classifyDesignIntent, createTemplateRuleSchema, generateDesignSchema };
