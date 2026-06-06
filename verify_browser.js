const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:5000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOT_DIR = path.join(__dirname, 'test-artifacts');
const REAL_REF_IMAGE = process.env.REAL_REF_IMAGE || path.join(__dirname, 'server/generated_images/workflow_inputs/tpl_c7ee5b63db77_ref_1_73c77020.jpg');
const REAL_ASSET_IMAGE = process.env.REAL_ASSET_IMAGE || path.join(__dirname, 'server/generated_images/workflow_inputs/tpl_c7ee5b63db77_asset_1_6aabb074.jpg');
const REAL_ASSET_IMAGE_2 = process.env.REAL_ASSET_IMAGE_2 || path.join(__dirname, 'test-assets/real_asset_clean_2.jpg');
fs.mkdirSync(SHOT_DIR, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('--- LIVE BROWSER SPLIT-FLOW VERIFICATION ---');
  assert(fs.existsSync(REAL_REF_IMAGE), `Missing real reference image: ${REAL_REF_IMAGE}`);
  assert(fs.existsSync(REAL_ASSET_IMAGE), `Missing real asset image: ${REAL_ASSET_IMAGE}`);
  assert(fs.existsSync(REAL_ASSET_IMAGE_2), `Missing second real asset image: ${REAL_ASSET_IMAGE_2}`);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const networkHits = [];
  page.on('request', req => {
    if (/\/api\/(templates\/generate|designs\/generate|templates|integrations\/status)/.test(req.url())) {
      networkHits.push({ method: req.method(), url: req.url() });
    }
  });

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.click('#tab-register-btn');
    await page.fill('#register-username', `browser_${Date.now()}`);
    await page.fill('#register-password', 'password123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#dashboard-section:not(.hidden)', { timeout: 10000 });
    await page.waitForSelector('#integration-status-panel .status-pill', { timeout: 10000 });
    console.log('✔ Registered user and dashboard loaded.');

    await page.fill('#headline-input', 'REAL ASSET GENERATION TEST');
    await page.setInputFiles('#asset-file-input', REAL_ASSET_IMAGE);
    await page.waitForFunction(() => window.deconstructState?.assetFilesBase64?.length === 1, null, { timeout: 10000 });
    await page.click('.submit-action-btn');
    await page.waitForSelector('.toast-error', { timeout: 10000 });
    const validationToast = await page.textContent('.toast-error');
    assert(/template rule/i.test(validationToast || ''), 'Generation should be blocked until a template rule is selected.');
    console.log('✔ UI blocks design generation without selected template rule.');

    await page.setInputFiles('#ref-file-input', REAL_REF_IMAGE);
    await page.waitForFunction(() => window.deconstructState?.refFilesBase64?.length === 1, null, { timeout: 10000 });
    const templateResponsePromise = page.waitForResponse(res => res.url().includes('/api/templates/generate') && res.request().method() === 'POST', { timeout: 240000 });
    await page.click('#create-template-rule-btn');
    const templateResponse = await templateResponsePromise;
    const templatePayload = await templateResponse.json().catch(() => ({}));
    assert(templateResponse.ok(), `Template-rule creation failed: ${JSON.stringify(templatePayload)}`);
    assert(templatePayload.template?.templateId, 'Template-rule creation did not return a template id.');
    assert((templatePayload.template?.ruleText || '').length > 500, 'Template-rule creation returned too little rule text.');
    await page.waitForFunction(() => {
      const viewer = document.querySelector('#template-rule-viewer');
      return window.deconstructState?.selectedTemplateId
        && window.deconstructState?.selectedTemplate?.ruleText
        && viewer
        && !viewer.classList.contains('hidden')
        && viewer.innerText.length > 500;
    }, null, { timeout: 30000 });
    console.log(`✔ Created and selected template rule ${templatePayload.template.templateId} from real reference JPEG.`);
    await page.waitForFunction((templateId) => {
      return Array.from(document.querySelectorAll('#template-list .template-card')).some(card => card.innerText.includes(templateId));
    }, templatePayload.template.templateId, { timeout: 30000 });
    console.log('✔ Newly created template appears in the sidebar without page refresh.');

    await page.setInputFiles('#asset-file-input', [REAL_ASSET_IMAGE, REAL_ASSET_IMAGE_2]);
    await page.waitForFunction(() => window.deconstructState?.assetFilesBase64?.length === 2, null, { timeout: 10000 });
    await page.fill('#headline-input', 'REAL ASSET GENERATION TEST');
    const designResponsePromise = page.waitForResponse(res => res.url().includes('/api/designs/generate') && res.request().method() === 'POST', { timeout: 240000 });
    await page.click('.submit-action-btn');
    const designResponse = await designResponsePromise;
    const designPayload = await designResponse.json().catch(() => ({}));
    assert(designResponse.ok(), `Design generation failed honestly: ${JSON.stringify(designPayload)}`);
    assert(designPayload.design?.templateId === templatePayload.template.templateId, 'Generated design did not use the selected template id.');
    assert(designPayload.design?.generation?.integrations?.n8n?.openai?.conditioning?.referenceImageCount === 0, 'Image generation workflow must not use reference images.');
    const fields = designPayload.design?.generation?.integrations?.n8n?.openai?.conditioning?.inputBinaryFields || [];
    assert(JSON.stringify(fields) === JSON.stringify(['asset_1', 'asset_2']), `Image generation must pass both real asset binary fields into OpenAI image edit, got ${JSON.stringify(fields)}.`);
    assert(designPayload.design?.generation?.realImageGeneration?.outputImageSize === '1536x1024', 'YouTube Thumbnail must request explicit landscape gpt-image-1 size 1536x1024.');
    assert(designPayload.design?.slides?.[0]?.generatedImageUrl, 'Generated design did not return an image URL.');
    assert(!designPayload.design.slides[0].generatedImageUrl.endsWith('.svg'), 'Generated design must be the raw provider image, not a composed SVG wrapper.');
    await page.waitForFunction(() => window.deconstructState?.currentDesign?.slides?.[0]?.generatedImageUrl, null, { timeout: 30000 });
    await page.waitForSelector('#download-design-btn:not([disabled])', { timeout: 30000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'browser-split-real-jpeg.png'), fullPage: true });
    console.log('✔ Generated design from selected template rule and two real asset JPEGs with explicit landscape size.');

    await page.evaluate(() => {
      const designRadio = document.querySelector('input[name="designType"][value="LinkedIn Carousel"]');
      designRadio.checked = true;
      updateDesignTypeSelection(designRadio);
      const carouselRadio = document.querySelector('input[name="generationMode"][value="carousel"]');
      carouselRadio.checked = true;
      updateGenerationModeSelection(carouselRadio);
    });
    await page.fill('#headline-input', 'CAROUSEL SLIDE ONE | CAROUSEL SLIDE TWO');
    await page.setInputFiles('#asset-file-input', [REAL_ASSET_IMAGE, REAL_ASSET_IMAGE_2]);
    await page.waitForFunction(() => window.deconstructState?.assetFilesBase64?.length === 2, null, { timeout: 10000 });
    const carouselResponsePromise = page.waitForResponse(res => res.url().includes('/api/designs/generate') && res.request().method() === 'POST', { timeout: 300000 });
    await page.click('.submit-action-btn');
    const carouselResponse = await carouselResponsePromise;
    const carouselPayload = await carouselResponse.json().catch(() => ({}));
    assert(carouselResponse.ok(), `Carousel generation failed honestly: ${JSON.stringify(carouselPayload)}`);
    const carouselDesign = carouselPayload.design || {};
    assert(carouselDesign.mode === 'carousel', `Expected carousel mode, got ${carouselDesign.mode}.`);
    assert((carouselDesign.slides || []).length >= 2, `Carousel must return multiple slides, got ${(carouselDesign.slides || []).length}.`);
    assert((carouselDesign.generation?.realImageGeneration?.generatedImages || []).length === carouselDesign.slides.length, 'Carousel must generate one output image per slide.');
    assert(carouselDesign.generation?.realImageGeneration?.generatedCount === carouselDesign.slides.length, 'Carousel generatedCount must match slide count.');
    assert(carouselDesign.generation?.realImageGeneration?.outputImageSize === '1024x1024', 'LinkedIn Carousel must request explicit square gpt-image-1 size 1024x1024.');
    for (const [index, slide] of carouselDesign.slides.entries()) {
      assert(slide.generatedImageUrl, `Carousel slide ${index + 1} is missing a generated image URL.`);
      assert(!slide.generatedImageUrl.endsWith('.svg'), `Carousel slide ${index + 1} must be the raw provider image, not a composed SVG wrapper.`);
    }
    await page.waitForFunction(() => window.deconstructState?.currentDesign?.slides?.length >= 2, null, { timeout: 30000 });
    assert(await page.locator('#carousel-controls:not(.hidden)').count() === 1, 'Carousel controls should appear when multiple slides are generated.');
    await page.screenshot({ path: path.join(SHOT_DIR, 'browser-carousel-real-jpeg.png'), fullPage: true });
    console.log(`✔ Carousel mode generated ${carouselDesign.slides.length} output images/slides with explicit square size.`);

    assert(networkHits.some(hit => hit.url.includes('/api/templates/generate')), 'Browser did not call template-rule creation endpoint.');
    assert(networkHits.some(hit => hit.url.includes('/api/designs/generate')), 'Browser did not call design generation endpoint.');
    assert(networkHits.some(hit => hit.url.includes('/api/integrations/status')), 'Browser did not request integration status.');
    console.log('✔ Network evidence captured for split endpoints.');
  } finally {
    await browser.close();
  }

  console.log('--- LIVE BROWSER SPLIT-FLOW VERIFICATION PASSED ---');
}

main().catch(error => {
  console.error('✖ LIVE BROWSER SPLIT-FLOW VERIFICATION FAILED:', error.message);
  process.exit(1);
});
