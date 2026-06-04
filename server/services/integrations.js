const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = Number(process.env.INTEGRATION_TIMEOUT_MS || 2500);

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timeout) };
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { controller, done } = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    done();
  }
}

function buildPublicServiceUrl(publicOrigin, port) {
  if (!publicOrigin) return null;
  try {
    const url = new URL(publicOrigin);
    url.port = String(port);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return null;
  }
}

async function getIntegrationStatus(options = {}) {
  const n8nBaseUrl = process.env.N8N_BASE_URL || 'http://localhost:5678';
  const flowiseBaseUrl = process.env.FLOWISE_BASE_URL || 'http://localhost:3000';
  const mcpBaseUrl = process.env.MCP_HTTP_URL || 'http://localhost:5001';
  const publicOrigin = options.publicOrigin || null;
  const n8nPublicUrl = options.publicUrls?.n8n || buildPublicServiceUrl(publicOrigin, 5678);
  const flowisePublicUrl = options.publicUrls?.flowise || buildPublicServiceUrl(publicOrigin, 3000);

  const [n8n, flowise, mcp, pinecone] = await Promise.all([
    fetchJson(`${n8nBaseUrl}/healthz`).then(r => ({ name: 'n8n', configured: true, publicUrl: n8nPublicUrl, ok: r.ok, status: r.status, error: r.error || null })),
    fetchJson(`${flowiseBaseUrl}/api/v1/ping`).then(r => ({ name: 'flowise', configured: true, publicUrl: flowisePublicUrl, ok: r.ok, status: r.status, error: r.error || null })),
    fetchJson(`${mcpBaseUrl}/mcp/status`).then(r => ({ name: 'mcp-http', configured: true, ok: r.ok, status: r.status, error: r.error || null })),
    getPineconeStatus()
  ]);

  return { n8n, flowise, mcp, pinecone };
}

async function getPineconeStatus() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexHost = process.env.PINECONE_INDEX_HOST;
  const indexName = process.env.PINECONE_INDEX_NAME || 'graphics-templates';
  const namespace = process.env.PINECONE_NAMESPACE || 'rulesets';
  const configured = Boolean(apiKey);
  const remoteStatusEnabled = process.env.ENABLE_PINECONE_REMOTE_STATUS === 'true';

  if (!configured) {
    return {
      name: 'pinecone',
      configured: false,
      ok: false,
      mode: 'local-template-memory',
      indexName,
      namespace,
      error: 'PINECONE_API_KEY missing; remote Pinecone sync is disabled, so template memory is stored locally.'
    };
  }

  if (!remoteStatusEnabled) {
    return {
      name: 'pinecone',
      configured: true,
      ok: true,
      mode: 'remote-status-disabled',
      indexName,
      namespace,
      indexHostConfigured: Boolean(indexHost),
      error: null
    };
  }

  const result = await fetchJson('https://api.pinecone.io/indexes', {
    headers: { 'Api-Key': apiKey, 'X-Pinecone-API-Version': '2025-04' }
  }, 4000);
  return {
    name: 'pinecone',
    configured: true,
    ok: result.ok,
    mode: 'remote-status-enabled',
    status: result.status,
    indexes: result.json?.indexes?.map(i => i.name) || [],
    indexName,
    namespace,
    error: result.error || (!result.ok ? JSON.stringify(result.json || {}) : null),
    indexHostConfigured: Boolean(indexHost)
  };
}

async function notifyN8n(payload) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/deconstruct-ai-generate';
  const webhookTimeoutMs = Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 180000);
  const result = await fetchJson(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, webhookTimeoutMs);
  return { attempted: true, ok: result.ok, status: result.status, error: result.error || null, response: result.json || null };
}

async function orchestrateDesignWithN8n(payload) {
  const n8n = await notifyN8n(payload);
  const evidence = n8n.response?.evidence || {};
  const flowise = n8n.response?.flowise || null;
  return {
    attempted: true,
    ok: Boolean(n8n.ok && n8n.response?.source === 'n8n-live-orchestrator' && evidence.n8n && evidence.flowise),
    status: n8n.status,
    error: n8n.error || (!n8n.ok ? JSON.stringify(n8n.response || {}) : null),
    source: n8n.response?.source || null,
    workflow: n8n.response?.n8nWorkflow || null,
    evidence,
    flowise,
    response: n8n.response || null
  };
}

async function callFlowise(question, overrideConfig = {}) {
  const chatflowId = process.env.FLOWISE_CHATFLOW_ID;
  if (!chatflowId) return { attempted: false, ok: false, error: 'FLOWISE_CHATFLOW_ID not configured' };
  const baseUrl = process.env.FLOWISE_BASE_URL || 'http://localhost:3000';
  const result = await fetchJson(`${baseUrl}/api/v1/prediction/${chatflowId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, overrideConfig })
  }, 10000);
  return { attempted: true, ok: result.ok, status: result.status, error: result.error || null, response: result.json || null };
}

async function upsertTemplateMemory(template) {
  const localVector = crypto.createHash('sha256').update(JSON.stringify(template)).digest('hex');
  const apiKey = process.env.PINECONE_API_KEY;
  const indexHost = process.env.PINECONE_INDEX_HOST;
  if (!apiKey || !indexHost) {
    return { attempted: false, ok: false, localVector, error: 'Pinecone index host not configured; stored in local template memory only.' };
  }

  const vector = Array.from({ length: 64 }, (_, i) => parseInt(localVector.slice((i % 32), (i % 32) + 2), 16) / 255);
  const result = await fetchJson(`https://${indexHost}/vectors/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
      'X-Pinecone-API-Version': '2025-04'
    },
    body: JSON.stringify({
      namespace: process.env.PINECONE_NAMESPACE || 'rulesets',
      vectors: [{ id: template.templateId, values: vector, metadata: { designType: template.designType, mode: template.mode, summary: template.summary.slice(0, 900) } }]
    })
  }, 7000);
  return { attempted: true, ok: result.ok, status: result.status, localVector, error: result.error || (!result.ok ? JSON.stringify(result.json || {}) : null) };
}

module.exports = { getIntegrationStatus, notifyN8n, orchestrateDesignWithN8n, callFlowise, upsertTemplateMemory };
