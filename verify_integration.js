const fs = require('fs');
const path = require('path');
const loadEnv = require('./server/config/loadEnv');
const { getPostgresStatus } = require('./server/services/templateRuleStore');

loadEnv(__dirname);

const externalChecksEnabled = process.env.ENABLE_EXTERNAL_INTEGRATION_CHECKS === 'true' || process.argv.includes('--external');
const MCP_URL = process.env.MCP_HTTP_URL || 'http://localhost:5001';
const N8N_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';
const FLOWISE_URL = process.env.FLOWISE_BASE_URL || 'http://localhost:3000';

async function fetchStatus(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.INTEGRATION_TIMEOUT_MS || 2500));
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { name, configured: true, ok: res.ok, status: res.status };
  } catch (error) {
    return { name, configured: true, ok: false, status: 0, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  console.log('--- LOCAL INTEGRATION WIRING CHECK ---');
  console.log('External API checks:', externalChecksEnabled ? 'enabled (read-only)' : 'disabled');

  const packageFiles = ['package.json', 'mcp-server/package.json', 'docker-compose.yml', '.env.example'];
  for (const file of packageFiles) {
    if (!fs.existsSync(path.join(__dirname, file))) throw new Error(`Missing required setup file: ${file}`);
  }
  console.log('✔ Required setup files present.');

  const [mcp, n8n, flowise, postgres] = await Promise.all([
    fetchStatus('mcp-http', `${MCP_URL.replace(/\/$/, '')}/mcp/status`),
    fetchStatus('n8n', `${N8N_URL.replace(/\/$/, '')}/healthz`),
    fetchStatus('flowise', `${FLOWISE_URL.replace(/\/$/, '')}/api/v1/ping`),
    getPostgresStatus()
  ]);

  const statuses = [mcp, n8n, flowise, postgres];
  for (const status of statuses) {
    const detail = status.ok ? `ok${status.status ? ` (${status.status})` : ''}` : `not ready${status.error ? `: ${status.error}` : ''}`;
    console.log(`- ${status.name}: ${detail}`);
  }

  if (postgres.configured && !postgres.ok) {
    throw new Error(`PostgreSQL is configured but unavailable: ${postgres.error}`);
  }

  console.log('✔ Wiring check completed without paid API calls by default.');
  if (!externalChecksEnabled) {
    console.log('  To run read-only external checks, set ENABLE_EXTERNAL_INTEGRATION_CHECKS=true or pass --external.');
  }
}

main().catch(err => {
  console.error('\n✖ INTEGRATION WIRING CHECK FAILED:', err.message);
  process.exit(1);
});
