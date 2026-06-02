const fs = require('fs');
const path = require('path');

const MCP_URL = 'http://localhost:5001';
const LOG_FILE = path.join(__dirname, 'logs', 'mcp_activity.log');
const CACHE_FILE = path.join(__dirname, 'logs', 'cache', 'verify_test.txt');

async function runMcpTests() {
  console.log('--- STARTING MCP LOCAL PORT 5001 FUNCTIONAL TESTS ---');

  // Test 1: HTTP MCP Log Endpoint
  console.log('\nTest 1: Triggering MCP logging tool...');
  const logRes = await fetch(`${MCP_URL}/mcp/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'mcp_verification_event',
      user_context: 'tester',
      data: { status: 'testing_mcp_layer' }
    })
  });
  
  const logData = await logRes.json();
  if (logRes.status !== 200 || logData.status !== 'success') {
    throw new Error(`MCP logging failed: ${JSON.stringify(logData)}`);
  }
  console.log('✔ Log call accepted by MCP server.');

  // Assert local file write
  if (!fs.existsSync(LOG_FILE)) {
    throw new Error('MCP log file not created.');
  }
  const logContents = fs.readFileSync(LOG_FILE, 'utf8');
  if (!logContents.includes('mcp_verification_event')) {
    throw new Error('MCP verification event missing from logs.');
  }
  console.log('✔ Verified audit entry in local activity log.');

  // Test 2: HTTP MCP Cache Endpoint
  console.log('\nTest 2: Triggering MCP file caching tool...');
  const testContent = 'Deconstruct AI local MCP file caching works successfully!';
  const cacheRes = await fetch(`${MCP_URL}/mcp/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'verify_test.txt',
      content: testContent
    })
  });

  const cacheData = await cacheRes.json();
  if (cacheRes.status !== 200 || cacheData.status !== 'success') {
    throw new Error(`MCP caching failed: ${JSON.stringify(cacheData)}`);
  }
  console.log('✔ Cache call accepted by MCP server.');

  // Assert local file write
  if (!fs.existsSync(CACHE_FILE)) {
    throw new Error('MCP cache file not created.');
  }
  const cacheContents = fs.readFileSync(CACHE_FILE, 'utf8');
  if (cacheContents !== testContent) {
    throw new Error('MCP cache content mismatch.');
  }
  console.log('✔ Verified cached contents in local file cache directory.');

  console.log('\n--- ALL MCP LOCAL SERVICE TESTS PASSED SUCCESSFULLY ---');
}

runMcpTests().catch(err => {
  console.error('\n✖ MCP TEST FAILED:', err.message);
  process.exit(1);
});
