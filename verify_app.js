const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test Config
const TEST_PORT = 5555;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const USERS_FILE = path.join(__dirname, 'server', 'users.json');
const DESIGNS_FILE = path.join(__dirname, 'server', 'designs.json');

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting test server on port', TEST_PORT);
    
    // Backup existing DBs
    if (fs.existsSync(USERS_FILE)) fs.renameSync(USERS_FILE, USERS_FILE + '.bak');
    if (fs.existsSync(DESIGNS_FILE)) fs.renameSync(DESIGNS_FILE, DESIGNS_FILE + '.bak');

    serverProcess = spawn('node', [path.join(__dirname, 'server', 'server.js')], {
      env: { ...process.env, PORT: TEST_PORT },
      stdio: 'pipe'
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Server]: ${output.trim()}`);
      if (output.includes('Server listening on')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error]: ${data}`);
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

function restoreBackups() {
  console.log('Restoring database backups...');
  
  // Delete test runs
  if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE);
  if (fs.existsSync(DESIGNS_FILE)) fs.unlinkSync(DESIGNS_FILE);

  // Restore backup
  if (fs.existsSync(USERS_FILE + '.bak')) fs.renameSync(USERS_FILE + '.bak', USERS_FILE);
  if (fs.existsSync(DESIGNS_FILE + '.bak')) fs.renameSync(DESIGNS_FILE + '.bak', DESIGNS_FILE);
}

function stopServer() {
  if (serverProcess) {
    console.log('Stopping test server...');
    serverProcess.kill();
    restoreBackups();
  }
}

async function runTests() {
  let token = '';
  const testUser = {
    username: `testuser_${Math.random().toString(36).substr(2, 5)}`,
    password: 'password123'
  };

  console.log('\n--- STARTING PROGRAMMATIC API TESTS ---');

  // Test 1: User Registration
  console.log('\nTest 1: User Registration...');
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
  });
  
  const regData = await regRes.json();
  if (regRes.status !== 201 || !regData.token || regData.username !== testUser.username) {
    throw new Error(`Registration failed: ${JSON.stringify(regData)}`);
  }
  console.log('✔ Registration successful.');

  // Test 2: User Login
  console.log('\nTest 2: User Login...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
  });
  
  const loginData = await loginRes.json();
  if (loginRes.status !== 200 || !loginData.token) {
    throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
  }
  token = loginData.token;
  console.log('✔ Login successful. Token retrieved.');

  // Test 3: Authenticated Get Me
  console.log('\nTest 3: Fetching authenticated profile (/api/auth/me)...');
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const meData = await meRes.json();
  if (meRes.status !== 200 || meData.username !== testUser.username) {
    throw new Error(`Profile verification failed: ${JSON.stringify(meData)}`);
  }
  console.log('✔ Profile verified successfully.');

  // Test 4: Integration status should be available without external API calls by default
  console.log('\nTest 4: Integration status (/api/integrations/status)...');
  const integrationRes = await fetch(`${BASE_URL}/api/integrations/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const integrationData = await integrationRes.json();
  if (integrationRes.status !== 200 || !integrationData.n8n || !integrationData.flowise || !integrationData.mcp || !integrationData.pinecone) {
    throw new Error(`Integration status failed: ${JSON.stringify(integrationData)}`);
  }
  console.log('✔ Integration status structure verified.');

  // Test 5: Design Generation Node
  console.log('\nTest 5: Design Generation (/api/designs/generate)...');
  const designPayload = {
    designType: 'LinkedIn Carousel',
    userCopyTexts: ['Verify Slide 1 Caption', 'Verify Slide 2 Caption', 'Verify Slide 3 Caption'],
    brandPalette: ['#1e293b', '#6366f1', '#10b981', '#ffffff']
  };

  const genRes = await fetch(`${BASE_URL}/api/designs/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(designPayload)
  });
  
  const genData = await genRes.json();
  const joinedText = designPayload.userCopyTexts.join(' | ');
  if (genRes.status !== 200 || !genData.design || genData.design.userCopyText !== joinedText) {
    throw new Error(`Design generation failed: ${JSON.stringify(genData)}`);
  }
  if (!genData.design.slides || genData.design.slides.length !== 3) {
    throw new Error(`Design slides structure error: ${JSON.stringify(genData.design.slides)}`);
  }
  if (genData.design.generation?.strategy !== 'n8n-flowise-orchestrated-schema-render') {
    throw new Error(`Generation strategy should be orchestrated: ${genData.design.generation?.strategy}`);
  }
  if (!genData.design.generation?.integrations?.n8n?.ok) {
    throw new Error(`n8n orchestration did not succeed: ${JSON.stringify(genData.design.generation?.integrations?.n8n)}`);
  }
  if (!genData.design.generation?.integrations?.flowise?.ok) {
    throw new Error(`Flowise orchestration did not succeed: ${JSON.stringify(genData.design.generation?.integrations?.flowise)}`);
  }
  console.log('✔ Design layout schemas (3 slides) generated & stored with n8n/Flowise evidence.');



  // Test 6: YouTube thumbnail with one reference and two assets must remain one composite design
  console.log('\nTest 6: YouTube Thumbnail multi-asset single-output regression...');
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const thumbnailPayload = {
    designType: 'YouTube Thumbnail',
    userCopyTexts: ['See Legends!'],
    brandPalette: ['#111827', '#b11226', '#f8fafc', '#ffffff'],
    referenceImageFiles: [tinyPng],
    userAssetFiles: [tinyPng, tinyPng]
  };
  const thumbRes = await fetch(`${BASE_URL}/api/designs/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(thumbnailPayload)
  });
  const thumbData = await thumbRes.json();
  if (thumbRes.status !== 200 || thumbData.design.mode !== 'single' || thumbData.design.slides.length !== 1) {
    throw new Error(`Thumbnail should be a single output: ${JSON.stringify(thumbData)}`);
  }
  if (!thumbData.design.slides[0].assets || thumbData.design.slides[0].assets.length !== 2) {
    throw new Error(`Thumbnail should preserve two asset placements: ${JSON.stringify(thumbData.design.slides[0])}`);
  }
  if (thumbData.design.intent.reason.includes('carousel')) {
    throw new Error(`Thumbnail intent reason should not classify as carousel: ${JSON.stringify(thumbData.design.intent)}`);
  }
  if (thumbData.design.generation?.strategy !== 'n8n-flowise-orchestrated-schema-render') {
    throw new Error(`Thumbnail generation strategy should be orchestrated: ${thumbData.design.generation?.strategy}`);
  }
  if (!thumbData.design.generation?.integrations?.n8n?.ok) {
    throw new Error(`Thumbnail n8n orchestration did not succeed: ${JSON.stringify(thumbData.design.generation?.integrations?.n8n)}`);
  }
  if (!thumbData.design.generation?.integrations?.flowise?.ok) {
    throw new Error(`Thumbnail Flowise orchestration did not succeed: ${JSON.stringify(thumbData.design.generation?.integrations?.flowise)}`);
  }
  console.log('✔ Multi-asset thumbnail regression verified: one slide, two asset placements, with n8n/Flowise evidence.');

  // Test 7: Design History Retrieve
  console.log('\nTest 7: History portfolio lookup (/api/designs/history)...');
  const historyRes = await fetch(`${BASE_URL}/api/designs/history`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const historyData = await historyRes.json();
  if (historyRes.status !== 200 || !Array.isArray(historyData) || historyData.length === 0) {
    throw new Error(`Portfolio retrieval failed: ${JSON.stringify(historyData)}`);
  }
  
  const carouselHistory = historyData.find(item => item.userCopyText === joinedText && item.designType === 'LinkedIn Carousel');
  const thumbnailHistory = historyData.find(item => item.userCopyText === 'See Legends!' && item.designType === 'YouTube Thumbnail');
  if (!carouselHistory || !thumbnailHistory) {
    throw new Error(`Expected generated carousel and thumbnail in history: ${JSON.stringify(historyData.map(d => ({ type: d.designType, text: d.userCopyText })))}`);
  }
  console.log('✔ Portfolio history validation completed successfully.');

  console.log('\n--- ALL TEST SUITES PASSED SUCCESSFULLY ---');
}

async function main() {
  try {
    await startServer();
    await runTests();
    stopServer();
    process.exit(0);
  } catch (err) {
    console.error('\n✖ TEST FAILED:', err.message);
    stopServer();
    process.exit(1);
  }
}

main();
