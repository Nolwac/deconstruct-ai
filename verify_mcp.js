const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MCP_URL = process.env.MCP_HTTP_URL || 'http://localhost:5001';
const LOG_FILE = path.join(__dirname, 'logs', 'mcp_activity.log');
const CACHE_FILE = path.join(__dirname, 'logs', 'cache', 'verify_test.txt');
let ownedServer = null;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  return { res, data };
}

async function isRunning() {
  try {
    const { res } = await fetchJson(`${MCP_URL}/mcp/status`);
    return res.ok;
  } catch (_) {
    return false;
  }
}

function startMcpServer() {
  return new Promise((resolve, reject) => {
    ownedServer = spawn('node', [path.join(__dirname, 'mcp-server', 'index.js')], {
      cwd: __dirname,
      env: { ...process.env, MCP_PORT: '5001' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timeout = setTimeout(() => reject(new Error('MCP server startup timed out')), 8000);
    ownedServer.stdout.on('data', data => {
      const text = data.toString();
      process.stdout.write(`[MCP]: ${text}`);
      if (text.includes('HTTP server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    ownedServer.stderr.on('data', data => process.stderr.write(`[MCP Error]: ${data}`));
    ownedServer.on('error', reject);
  });
}

function stopMcpServer() {
  if (ownedServer) ownedServer.kill();
}

async function runMcpTests() {
  console.log('--- STARTING MCP FUNCTIONAL TESTS ---');

  if (!(await isRunning())) {
    console.log('MCP HTTP server not running; starting local test instance...');
    await startMcpServer();
  }

  console.log('\nTest 1: MCP status endpoint...');
  const statusCall = await fetchJson(`${MCP_URL}/mcp/status`);
  if (!statusCall.res.ok || statusCall.data.status !== 'ok') throw new Error(`MCP status failed: ${JSON.stringify(statusCall.data)}`);
  console.log('✔ MCP status endpoint healthy.');

  console.log('\nTest 2: Triggering MCP logging tool...');
  const logCall = await fetchJson(`${MCP_URL}/mcp/log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'mcp_verification_event', user_context: 'tester', data: { status: 'testing_mcp_layer' } })
  });
  if (logCall.res.status !== 200 || logCall.data.status !== 'success') throw new Error(`MCP logging failed: ${JSON.stringify(logCall.data)}`);
  if (!fs.existsSync(LOG_FILE) || !fs.readFileSync(LOG_FILE, 'utf8').includes('mcp_verification_event')) throw new Error('MCP verification event missing from logs.');
  console.log('✔ Log call accepted and written.');

  console.log('\nTest 3: Triggering MCP file caching tool...');
  const testContent = 'Deconstruct AI local MCP file caching works successfully!';
  const cacheCall = await fetchJson(`${MCP_URL}/mcp/cache`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: '../verify_test.txt', content: testContent })
  });
  if (cacheCall.res.status !== 200 || cacheCall.data.status !== 'success') throw new Error(`MCP caching failed: ${JSON.stringify(cacheCall.data)}`);
  if (!fs.existsSync(CACHE_FILE) || fs.readFileSync(CACHE_FILE, 'utf8') !== testContent) throw new Error('MCP cache content mismatch.');
  console.log('✔ Cache call accepted, path sanitized, and file written.');

  console.log('\nTest 4: Classify thumbnail vs carousel intent through MCP HTTP...');
  const classifyCall = await fetchJson(`${MCP_URL}/mcp/classify-intent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ designType: 'YouTube Thumbnail', userCopyTexts: ['See Legends!'], referenceImageFiles: ['sample'], userAssetFiles: ['bob', 'ninja'] })
  });
  if (classifyCall.data.intent.mode !== 'single' || classifyCall.data.intent.slideCount !== 1) throw new Error(`Intent classification failed: ${JSON.stringify(classifyCall.data)}`);
  console.log('✔ MCP classified multi-asset thumbnail as one slide.');

  console.log('\nTest 5: Generate design schema through MCP HTTP...');
  const schemaCall = await fetchJson(`${MCP_URL}/mcp/design-schema`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ designType: 'YouTube Thumbnail', userCopyTexts: ['See Legends!'], referenceImageFiles: ['sample'], userAssetFiles: ['bob', 'ninja'] })
  });
  if (schemaCall.res.status !== 200 || schemaCall.data.design.mode !== 'single' || schemaCall.data.design.slides.length !== 1 || schemaCall.data.design.slides[0].assets.length !== 2) {
    throw new Error(`MCP schema generation failed: ${JSON.stringify(schemaCall.data)}`);
  }
  console.log('✔ MCP generated and cached a single-slide multi-asset thumbnail schema.');

  console.log('\n--- ALL MCP FUNCTIONAL TESTS PASSED SUCCESSFULLY ---');
}

runMcpTests().then(() => {
  stopMcpServer();
}).catch(err => {
  console.error('\n✖ MCP TEST FAILED:', err.message);
  stopMcpServer();
  process.exit(1);
});
