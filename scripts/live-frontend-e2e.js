const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ARTIFACT_DIR = path.join(__dirname, '..', 'test-artifacts', 'live-frontend-e2e');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([len, typeBuffer, data, sum]);
}

function writePng(filePath, width, height, paint) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) raw[y * rowLength] = 0;
  const setPixel = (x, y, rgba) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = y * rowLength + 1 + x * 4;
    raw[o] = rgba[0]; raw[o + 1] = rgba[1]; raw[o + 2] = rgba[2]; raw[o + 3] = rgba[3];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setPixel(x, y, paint(x, y, width, height));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND')
  ]);
  fs.writeFileSync(filePath, png);
}

let refPath = process.env.REAL_REF_IMAGE || path.join(ARTIFACT_DIR, 'ui-reference-template.png');
let assetPath = process.env.REAL_ASSET_IMAGE || path.join(ARTIFACT_DIR, 'ui-asset-subject.png');
if (!process.env.REAL_REF_IMAGE) {
  writePng(refPath, 960, 540, (x, y, w, h) => {
    if (x < w * 0.55 && y > h * 0.15 && y < h * 0.72) return [238, 42, 55, 255];
    if (x < w * 0.48 && y > h * 0.76) return [255, 209, 64, 255];
    if (x > w * 0.60 && y > h * 0.15 && y < h * 0.85) return [38, 50, 66, 255];
    return [10, 12, 18, 255];
  });
}
if (!process.env.REAL_ASSET_IMAGE) {
  writePng(assetPath, 512, 512, (x, y, w, h) => {
    const dx = x - w / 2, dy = y - h / 2;
    if (dx * dx + dy * dy < 145 * 145) return [38, 99, 235, 255];
    if (Math.abs(x - y) < 16) return [255, 213, 79, 255];
    if (x > 330 && y > 100 && y < 410) return [236, 72, 153, 255];
    return [255, 255, 255, 0];
  });
}
assert(fs.existsSync(refPath), `Reference image not found: ${refPath}`);
assert(fs.existsSync(assetPath), `Asset image not found: ${assetPath}`);

async function main() {
  console.log('--- ACTUAL FRONTEND UI E2E: CHROMIUM + REAL DOM CONTROLS ---');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.setDefaultTimeout(30000);

  const evidence = { console: [], pageErrors: [], requests: [], responses: [] };
  page.on('console', msg => evidence.console.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => evidence.pageErrors.push({ message: err.message, stack: err.stack }));
  page.on('request', req => {
    if (/\/api\/(auth|templates|designs|integrations)/.test(req.url())) {
      evidence.requests.push({ method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', async res => {
    if (/\/api\/(auth|templates|designs|integrations)/.test(res.url())) {
      let body = '';
      try { body = (await res.text()).slice(0, 4000); } catch (_) {}
      evidence.responses.push({ status: res.status(), url: res.url(), body });
    }
  });

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-auth-page.png'), fullPage: true });

    const username = `ui_real_${Date.now()}`;
    await page.click('#tab-register-btn');
    await page.fill('#register-username', username);
    await page.fill('#register-password', 'Passw0rd!real-ui');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#dashboard-section:not(.hidden)');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-dashboard.png'), fullPage: true });
    console.log(`✔ Registered through frontend UI as ${username}`);

    await page.setInputFiles('#ref-file-input', refPath);
    await page.waitForFunction(() => window.deconstructState?.refFilesBase64?.length === 1);
    const templateResponsePromise = page.waitForResponse(res => res.url().includes('/api/templates/generate') && res.request().method() === 'POST', { timeout: 240000 });
    await page.click('#create-template-rule-btn');
    const templateResponse = await templateResponsePromise;
    const templateBody = await templateResponse.json().catch(() => ({}));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-after-template-create.png'), fullPage: true });
    assert(templateResponse.ok(), `Template creation failed via UI: HTTP ${templateResponse.status()} ${JSON.stringify(templateBody).slice(0, 1200)}`);
    assert(templateBody.template?.templateId, 'Template creation UI response did not include template id.');
    await page.waitForFunction(() => Boolean(window.deconstructState?.selectedTemplateId));
    console.log(`✔ Created/selected template through frontend UI: ${templateBody.template.templateId}`);

    await page.setInputFiles('#asset-file-input', assetPath);
    await page.waitForFunction(() => window.deconstructState?.assetFilesBase64?.length === 1);
    await page.fill('#headline-input', 'LIVE UI REAL TEST');

    const designResponsePromise = page.waitForResponse(res => res.url().includes('/api/designs/generate') && res.request().method() === 'POST', { timeout: 300000 });
    await page.click('.submit-action-btn');
    const designResponse = await designResponsePromise;
    const designBody = await designResponse.json().catch(() => ({}));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04-after-generate-response.png'), fullPage: true });

    if (!designResponse.ok()) {
      const toast = await page.locator('.toast-error').last().textContent().catch(() => '');
      throw new Error(`Design generation failed via frontend UI: HTTP ${designResponse.status()} toast=${toast} body=${JSON.stringify(designBody).slice(0, 2000)}`);
    }

    await page.waitForFunction(() => window.deconstructState?.currentDesign?.slides?.[0]?.generatedImageUrl, null, { timeout: 60000 });
    await page.waitForSelector('#download-design-btn:not([disabled])', { timeout: 60000 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#render-canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return data[3] > 0;
    }, null, { timeout: 60000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05-final-rendered-ui.png'), fullPage: true });

    assert(designBody.design?.slides?.[0]?.generatedImageUrl, 'Design response missing generatedImageUrl.');
    assert(designBody.design?.generation?.realImageGeneration?.provider === 'gemini-via-n8n', `Expected gemini-via-n8n, got ${designBody.design?.generation?.realImageGeneration?.provider}`);
    assert(designBody.design?.generation?.realImageGeneration?.model === 'models/gemini-3.1-flash-image', `Unexpected model ${designBody.design?.generation?.realImageGeneration?.model}`);
    const imageUrl = designBody.design.slides[0].generatedImageUrl;
    const absImagePath = path.join(__dirname, '..', 'server', imageUrl.replace(/^\/generated_images\//, 'generated_images/'));
    assert(fs.existsSync(absImagePath), `Generated image URL returned but file missing: ${absImagePath}`);
    const stat = fs.statSync(absImagePath);
    assert(stat.size > 10000, `Generated image file too small: ${stat.size}`);

    evidence.final = {
      templateId: templateBody.template.templateId,
      designId: designBody.design.id,
      generatedImageUrl: imageUrl,
      generatedImagePath: absImagePath,
      generatedBytes: stat.size,
      provider: designBody.design.generation.realImageGeneration.provider,
      model: designBody.design.generation.realImageGeneration.model
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('✔ Generated through actual frontend UI controls.');
    console.log(JSON.stringify(evidence.final, null, 2));
  } catch (err) {
    evidence.failure = { message: err.message, stack: err.stack };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'failure.png'), fullPage: true }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('✖ FRONTEND UI E2E FAILED:', error.message);
  process.exit(1);
});
