const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_PORT = 5555;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const USERS_FILE = path.join(__dirname, 'server', 'users.json');
const DESIGNS_FILE = path.join(__dirname, 'server', 'designs.json');

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting test server on port', TEST_PORT);
    if (fs.existsSync(USERS_FILE)) fs.renameSync(USERS_FILE, USERS_FILE + '.bak');
    if (fs.existsSync(DESIGNS_FILE)) fs.renameSync(DESIGNS_FILE, DESIGNS_FILE + '.bak');

    serverProcess = spawn('node', [path.join(__dirname, 'server', 'server.js')], {
      env: { ...process.env, PORT: TEST_PORT },
      stdio: 'pipe'
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Server]: ${output.trim()}`);
      if (output.includes('Server listening on')) resolve();
    });
    serverProcess.stderr.on('data', (data) => console.error(`[Server Error]: ${data}`));
    serverProcess.on('error', reject);
  });
}

function restoreBackups() {
  console.log('Restoring database backups...');
  if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE);
  if (fs.existsSync(DESIGNS_FILE)) fs.unlinkSync(DESIGNS_FILE);
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

async function authedFetch(token, url, options = {}) {
  return fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`
    }
  });
}

async function runTests() {
  const testUser = {
    username: `testuser_${Math.random().toString(36).substr(2, 5)}`,
    password: 'password123'
  };

  console.log('\n--- STARTING PROGRAMMATIC API TESTS ---');

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
  const token = loginData.token;
  console.log('✔ Login successful. Token retrieved.');

  console.log('\nTest 3: Authenticated profile (/api/auth/me)...');
  const meRes = await authedFetch(token, '/api/auth/me');
  const meData = await meRes.json();
  if (meRes.status !== 200 || meData.username !== testUser.username) {
    throw new Error(`Profile verification failed: ${JSON.stringify(meData)}`);
  }
  console.log('✔ Profile verified successfully.');

  console.log('\nTest 4: Integration status shape (/api/integrations/status)...');
  const integrationRes = await authedFetch(token, '/api/integrations/status');
  const integrationData = await integrationRes.json();
  if (integrationRes.status !== 200 || !integrationData.n8n || !integrationData.flowise || !integrationData.mcp || !integrationData.postgres) {
    throw new Error(`Integration status failed: ${JSON.stringify(integrationData)}`);
  }
  console.log('✔ Integration status structure verified.');

  console.log('\nTest 5: Template list endpoint returns saved-rule collection shape...');
  const templatesRes = await authedFetch(token, '/api/templates');
  const templatesData = await templatesRes.json();
  if (templatesRes.status !== 200 || !Array.isArray(templatesData)) {
    throw new Error(`Template list failed: ${JSON.stringify(templatesData)}`);
  }
  console.log('✔ Template list endpoint verified.');

  console.log('\nTest 6: Design generation refuses to run without a selected template rule...');
  const genRes = await authedFetch(token, '/api/designs/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      designType: 'YouTube Thumbnail',
      generationMode: 'single',
      userCopyTexts: ['Verify honest failure'],
      userAssetFiles: []
    })
  });
  const genData = await genRes.json();
  if (genRes.status !== 400 || genData.code !== 'DESIGN_GENERATION_INPUT_INVALID' || !/template rule/i.test(genData.message || '')) {
    throw new Error(`Expected selected-template validation failure: ${JSON.stringify(genData)}`);
  }
  console.log('✔ Generation now requires an explicit selected template rule.');

  console.log('\nTest 7: Missing template detail returns 404, not fallback content...');
  const missingTemplateRes = await authedFetch(token, '/api/templates/tpl_missing_for_test');
  const missingTemplateData = await missingTemplateRes.json();
  if (missingTemplateRes.status !== 404 || !/not found/i.test(missingTemplateData.message || '')) {
    throw new Error(`Expected missing-template 404: ${JSON.stringify(missingTemplateData)}`);
  }
  console.log('✔ Missing template detail fails honestly.');

  console.log('\n--- ALL PROGRAMMATIC API TESTS PASSED ---');
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
