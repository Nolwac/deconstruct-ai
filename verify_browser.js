const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:5000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOT_DIR = path.join(__dirname, 'test-artifacts');
fs.mkdirSync(SHOT_DIR, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function dropTinyPng(page, zoneSelector, count) {
  await page.dispatchEvent(zoneSelector, 'dragenter', { dataTransfer: await makeDataTransfer(page, count) });
  await page.dispatchEvent(zoneSelector, 'drop', { dataTransfer: await makeDataTransfer(page, count) });
}

async function makeDataTransfer(page, count) {
  return page.evaluateHandle((fileCount) => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    for (let i = 0; i < fileCount; i += 1) {
      dt.items.add(new File([bytes], `live-browser-${i + 1}.png`, { type: 'image/png' }));
    }
    return dt;
  }, count);
}

async function main() {
  console.log('--- LIVE BROWSER VERIFICATION ---');
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const networkHits = [];
  page.on('request', req => {
    if (req.url().includes('/api/designs/generate') || req.url().includes('/api/integrations/status')) {
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
    console.log('✔ Registered user and dashboard loaded with integration status panel.');

    await dropTinyPng(page, '#ref-file-container', 1);
    await dropTinyPng(page, '#asset-file-container', 2);
    await page.waitForFunction(() => window.deconstructState?.refFilesBase64?.length === 1 && window.deconstructState?.assetFilesBase64?.length === 2, null, { timeout: 10000 });
    await page.fill('#headline-input', 'See Legends!');

    const thumbResponsePromise = page.waitForResponse(res => res.url().includes('/api/designs/generate') && res.request().method() === 'POST', { timeout: 20000 });
    await page.click('.submit-action-btn');
    const thumbResponse = await thumbResponsePromise;
    const thumbPayload = await thumbResponse.json();
    await page.waitForFunction(() => window.deconstructState?.currentDesign?.slides?.length === 1, null, { timeout: 12000 });
    assert(thumbPayload.design.mode === 'single', 'Thumbnail should be single mode.');
    assert(thumbPayload.design.slides.length === 1, 'Thumbnail should render one output slide.');
    assert(thumbPayload.design.slides[0].assets.length === 2, 'Thumbnail should keep two asset placements.');
    assert(await page.locator('#carousel-controls.hidden').count() === 1, 'Carousel controls should be hidden for thumbnail.');
    assert(await page.locator('#download-design-btn:not([disabled])').count() === 1, 'Download button should become enabled.');
    await page.screenshot({ path: path.join(SHOT_DIR, 'browser-thumbnail.png'), fullPage: true });
    console.log('✔ YouTube thumbnail live flow generated one composite design from two assets.');

    await page.evaluate(() => {
      const radio = document.querySelector('input[name="designType"][value="LinkedIn Carousel"]');
      radio.checked = true;
      updateDesignTypeSelection();
    });
    await page.fill('#headline-input', 'Slide One | Slide Two | Slide Three');
    await dropTinyPng(page, '#ref-file-container', 3);
    await dropTinyPng(page, '#asset-file-container', 3);
    await page.waitForFunction(() => window.deconstructState?.refFilesBase64?.length === 3 && window.deconstructState?.assetFilesBase64?.length === 3, null, { timeout: 10000 });
    const carouselResponsePromise = page.waitForResponse(res => res.url().includes('/api/designs/generate') && res.request().method() === 'POST', { timeout: 20000 });
    await page.click('.submit-action-btn');
    const carouselResponse = await carouselResponsePromise;
    const carouselPayload = await carouselResponse.json();
    await page.waitForFunction(() => window.deconstructState?.currentDesign?.slides?.length === 3, null, { timeout: 12000 });
    assert(carouselPayload.design.mode === 'carousel', 'LinkedIn selected format should be carousel mode.');
    assert(carouselPayload.design.slides.length === 3, 'Carousel should produce three slides.');
    assert(await page.locator('#carousel-controls:not(.hidden)').count() === 1, 'Carousel controls should be visible.');
    assert((await page.textContent('#carousel-slide-indicator')).includes('Slide 1 of 3'), 'Slide indicator should show 1 of 3.');
    await page.screenshot({ path: path.join(SHOT_DIR, 'browser-carousel.png'), fullPage: true });
    console.log('✔ LinkedIn carousel live flow generated three slides and visible controls.');

    assert(networkHits.some(hit => hit.url.includes('/api/designs/generate')), 'Browser did not make backend generation calls.');
    assert(networkHits.some(hit => hit.url.includes('/api/integrations/status')), 'Browser did not request integration status.');
    console.log('✔ Network evidence captured for backend generation and integration status calls.');
  } finally {
    await browser.close();
  }

  console.log('--- LIVE BROWSER VERIFICATION PASSED ---');
}

main().catch(error => {
  console.error('✖ LIVE BROWSER VERIFICATION FAILED:', error.message);
  process.exit(1);
});
