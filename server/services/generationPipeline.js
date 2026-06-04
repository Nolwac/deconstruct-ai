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
      : 'Selected design type is a single-output format, so supplied assets are integrated by the AI into one final design.'
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
        retryInstructions: 'The previous Gemini image attempt returned no image. Regenerate as a realistic commercial design that visibly uses the supplied user asset images as the main subject/content. Avoid cartoon, illustration, anime, painterly, caricature, or stylized rendering unless the reference template explicitly requires it. Do not face-match, identify, name, impersonate, or exactly reproduce any real person. Preserve template rules, supplied text, colors, composition intent, and asset integration.'
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
  const aiTemplateRules = flowiseRules.layoutRules || existingTemplate?.styleGuide?.aiTemplateRules || existingTemplate?.style?.aiTemplateRules || null;
  const styleGuide = {
    source: existingTemplate ? 'stored-template-memory' : (referenceSources.length ? 'flowise-reference-analysis' : 'flowise-default-rules'),
    templateMode,
    aiTemplateRules,
    templateRuleQuality
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
    designType: input.designType,
    userCopyText: copies.join(' | '),
    mode: intent.mode,
    intent,
    slides,
    templateId,
    styleGuide,
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
    } catch (error) {
      throw new Error(`Generated image for slide ${slideIndex + 1} could not be saved: ${error.message}`);
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
    summary: `AI-only ${input.designType} template rules. ${intent.reason}`,
    styleGuide,
    style: { aiTemplateRules, templateRuleQuality },
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
    design.generation.warnings.push(`Pinecone memory sync failed; AI generation still completed: ${error.message}`);
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

module.exports = { classifyDesignIntent, generateDesignSchema };
