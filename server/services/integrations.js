const { getPostgresStatus } = require('./templateRuleStore');

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

function dataUrlToJsonBinary(dataUrl, fallbackName) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  const data = match[2];
  return {
    data,
    mimeType,
    fileName: `${fallbackName}.${ext}`,
    byteLength: Buffer.byteLength(data, 'base64')
  };
}

function buildN8nJsonBody(payload) {
  const binaryAssets = Array.isArray(payload.__n8nBinaryAssets) ? payload.__n8nBinaryAssets : [];
  const cleanPayload = { ...payload };
  delete cleanPayload.__n8nBinaryAssets;

  const n8nBinaryAssets = {};
  let assetIndex = 0;
  binaryAssets.forEach((asset) => {
    const fieldName = asset.fieldName || `asset_${assetIndex + 1}`;
    const fallbackName = fieldName || `asset_${assetIndex + 1}`;
    const binary = dataUrlToJsonBinary(asset.dataUrl, fallbackName);
    if (!binary) return;
    n8nBinaryAssets[fieldName] = {
      ...binary,
      fileName: asset.filename || binary.fileName
    };
    if (!asset.fieldName || /^asset_\d+$/.test(asset.fieldName)) assetIndex += 1;
  });

  return {
    ...cleanPayload,
    n8nBinaryAssets
  };
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

  const [n8n, flowise, mcp, postgres] = await Promise.all([
    fetchJson(`${n8nBaseUrl}/healthz`).then(r => ({ name: 'n8n', configured: true, publicUrl: n8nPublicUrl, ok: r.ok, status: r.status, error: r.error || null })),
    fetchJson(`${flowiseBaseUrl}/api/v1/ping`).then(r => ({ name: 'flowise', configured: true, publicUrl: flowisePublicUrl, ok: r.ok, status: r.status, error: r.error || null })),
    fetchJson(`${mcpBaseUrl}/mcp/status`).then(r => ({ name: 'mcp-http', configured: true, ok: r.ok, status: r.status, error: r.error || null })),
    getPostgresStatus()
  ]);

  return { n8n, flowise, mcp, postgres };
}

async function notifyN8n(payload, webhookUrl) {
  const url = webhookUrl || process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/deconstruct-ai-generate';
  const webhookTimeoutMs = Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 180000);
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildN8nJsonBody(payload))
  };
  const result = await fetchJson(url, request, webhookTimeoutMs);
  return { attempted: true, ok: result.ok, status: result.status, error: result.error || null, response: result.json || null };
}

function n8nWebhookUrl(path) {
  const base = process.env.N8N_BASE_URL || 'http://localhost:5678';
  return `${base.replace(/\/$/, '')}/webhook/${path}`;
}

async function orchestrateTemplateRulesWithN8n(payload) {
  const webhookUrl = process.env.N8N_TEMPLATE_RULE_WEBHOOK_URL || n8nWebhookUrl('deconstruct-ai-template-rules');
  const n8n = await notifyN8n(payload, webhookUrl);
  const evidence = n8n.response?.evidence || {};
  return {
    attempted: true,
    ok: Boolean(n8n.ok && n8n.response?.source === 'n8n-template-rule-creator' && evidence.templateRules === true),
    status: n8n.status,
    error: n8n.error || (!n8n.ok ? JSON.stringify(n8n.response || {}) : null),
    source: n8n.response?.source || null,
    workflow: n8n.response?.n8nWorkflow || null,
    evidence,
    response: n8n.response || null
  };
}

async function orchestrateDesignWithN8n(payload) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL || n8nWebhookUrl('deconstruct-ai-generate');
  const n8n = await notifyN8n(payload, webhookUrl);
  const evidence = n8n.response?.evidence || {};
  const nativeImageOk = Boolean(evidence.n8n && evidence.imageDataReturned && (
    (evidence.gemini && evidence.nativeGeminiImageEditNode)
    || (evidence.openai && evidence.nativeOpenAIImageEditNode)
  ));
  return {
    attempted: true,
    ok: Boolean(n8n.ok && n8n.response?.source === 'n8n-image-generation-orchestrator' && nativeImageOk),
    status: n8n.status,
    error: n8n.error || (!n8n.ok ? JSON.stringify(n8n.response || {}) : null),
    source: n8n.response?.source || null,
    workflow: n8n.response?.n8nWorkflow || null,
    evidence,
    flowise: null,
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

module.exports = { getIntegrationStatus, notifyN8n, orchestrateTemplateRulesWithN8n, orchestrateDesignWithN8n, callFlowise };
