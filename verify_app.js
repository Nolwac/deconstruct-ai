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

  // Test 4: Design Generation Node
  console.log('\nTest 4: Design Generation (/api/designs/generate)...');
  const designPayload = {
    designType: 'YouTube Thumbnail',
    userCopyText: 'Verify Test Headline Text',
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
  if (genRes.status !== 200 || !genData.design || genData.design.userCopyText !== designPayload.userCopyText) {
    throw new Error(`Design generation failed: ${JSON.stringify(genData)}`);
  }
  console.log('✔ Design layout schema generated & stored.');

  // Test 5: Design History Retrieve
  console.log('\nTest 5: History portfolio lookup (/api/designs/history)...');
  const historyRes = await fetch(`${BASE_URL}/api/designs/history`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const historyData = await historyRes.json();
  if (historyRes.status !== 200 || !Array.isArray(historyData) || historyData.length === 0) {
    throw new Error(`Portfolio retrieval failed: ${JSON.stringify(historyData)}`);
  }
  
  if (historyData[0].userCopyText !== designPayload.userCopyText) {
    throw new Error(`Data mismatch in retrieved portfolio card: ${historyData[0].userCopyText}`);
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
