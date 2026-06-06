const express = require('express');
const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const loadEnv = require('../server/config/loadEnv');
const { generateDesignSchema, classifyDesignIntent } = require('../server/services/generationPipeline');
const { getIntegrationStatus } = require('../server/services/integrations');

loadEnv(path.join(__dirname, '..'));

// ----------------------------------------------------
// Setup Paths & Logs
// ----------------------------------------------------
const LOG_FILE = path.join(__dirname, '../logs/mcp_activity.log');
const CACHE_DIR = path.join(__dirname, '../logs/cache');

// Ensure directories exist
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ----------------------------------------------------
// 1. HTTP Express Server (For n8n / HTTP integrations)
// ----------------------------------------------------
const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/mcp/status', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'deconstruct-ai-mcp',
    httpPort: Number(process.env.MCP_PORT || 5001),
    logFile: LOG_FILE,
    cacheDir: CACHE_DIR
  });
});

app.post('/mcp/log', (req, res) => {
  const { event, user_context, flowise_response, data } = req.body;
  console.log(`[HTTP MCP] Logging event: ${event || 'generic'}`);

  const logPayload = {
    event: event || 'generic',
    user_context: user_context || 'unknown',
    flowise_response: flowise_response || null,
    data: data || null
  };

  const logLine = `${new Date().toISOString()} - EVENT: ${logPayload.event} - USER_CONTEXT: ${logPayload.user_context} - DATA: ${JSON.stringify(logPayload)}\n`;
  fs.appendFileSync(LOG_FILE, logLine);

  res.status(200).json({
    status: 'success',
    message: 'Event logged successfully by MCP local logging tool.'
  });
});

app.post('/mcp/cache', (req, res) => {
  const { fileName, content } = req.body;
  if (!fileName || !content) {
    return res.status(400).json({ status: 'error', message: 'fileName and content are required.' });
  }

  const result = cacheFile(fileName, content);
  res.status(200).json({
    status: 'success',
    message: `File cached successfully by MCP file cache tool.`,
    path: result.path
  });
});

app.post('/mcp/design-schema', async (req, res) => {
  try {
    const input = req.body || {};
    if (!input.designType || !Array.isArray(input.userCopyTexts) || input.userCopyTexts.length === 0) {
      return res.status(400).json({ status: 'error', message: 'designType and userCopyTexts[] are required.' });
    }
    const design = await generateDesignSchema(input, { id: 'mcp_http_user', username: input.username || 'mcp-http' });
    const cache = cacheFile(`${design.id}.schema.json`, JSON.stringify(design, null, 2));
    res.status(200).json({ status: 'success', design, cachePath: cache.path });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/mcp/classify-intent', (req, res) => {
  try {
    res.status(200).json({ status: 'success', intent: classifyDesignIntent(req.body || {}) });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

function cacheFile(fileName, content) {
  const safeFileName = path.basename(fileName);
  console.log(`[MCP] Caching file: ${safeFileName}`);
  const filePath = path.join(CACHE_DIR, safeFileName);
  if (String(content).startsWith('data:image')) {
    const base64Data = content.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(filePath, base64Data, 'base64');
  } else {
    fs.writeFileSync(filePath, content);
  }
  return { fileName: safeFileName, path: filePath };
}

// Run Express Server on Port 5001
const HTTP_PORT = process.env.MCP_PORT || 5001;
app.listen(HTTP_PORT, () => {
  console.log(`[MCP Server] HTTP server listening on http://localhost:${HTTP_PORT}`);
});

// ----------------------------------------------------
// 2. Official Stdio MCP Server (For LLM Client Integrations)
// ----------------------------------------------------
const mcpServer = new Server(
  {
    name: 'deconstruct-ai-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register MCP Tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'mcp_log_event',
        description: 'Log and audit a specific design workflow event.',
        inputSchema: {
          type: 'object',
          properties: {
            event: { type: 'string', description: 'Name of the event (e.g. design_request_processing)' },
            data: { type: 'object', description: 'Associated event metadata' }
          },
          required: ['event', 'data']
        }
      },
      {
        name: 'mcp_cache_file',
        description: 'Save a generated design file or layout rule metadata to local cache.',
        inputSchema: {
          type: 'object',
          properties: {
            fileName: { type: 'string', description: 'Name of the file to cache' },
            content: { type: 'string', description: 'Base64 image content or JSON layout string' }
          },
          required: ['fileName', 'content']
        }
      },
      {
        name: 'mcp_classify_design_intent',
        description: 'Classify whether a design request is a single design or carousel and return slide-count reasoning.',
        inputSchema: {
          type: 'object',
          properties: {
            designType: { type: 'string' },
            userCopyTexts: { type: 'array', items: { type: 'string' } },
            referenceImageFiles: { type: 'array', items: { type: 'string' } },
            userAssetFiles: { type: 'array', items: { type: 'string' } }
          },
          required: ['designType', 'userCopyTexts']
        }
      },
      {
        name: 'mcp_generate_design_schema',
        description: 'Generate an AI-only Deconstruct AI design record from supplied references, assets, and exact copy.',
        inputSchema: {
          type: 'object',
          properties: {
            designType: { type: 'string' },
            userCopyTexts: { type: 'array', items: { type: 'string' } },
            referenceImageFiles: { type: 'array', items: { type: 'string' } },
            userAssetFiles: { type: 'array', items: { type: 'string' } }
          },
          required: ['designType', 'userCopyTexts']
        }
      },
      {
        name: 'mcp_get_integration_status',
        description: 'Return n8n, Flowise, PostgreSQL template-rule store, and MCP HTTP wiring status.',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  };
});

// Handle Tool Executions
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.error(`[Stdio MCP] Tool called: ${name}`);

  if (name === 'mcp_log_event') {
    const { event, data } = args;
    const logLine = `${new Date().toISOString()} - EVENT: ${event} - DATA: ${JSON.stringify(data)}\n`;
    fs.appendFileSync(LOG_FILE, logLine);
    return {
      content: [{ type: 'text', text: `Event '${event}' logged successfully to local MCP audit trail.` }]
    };
  }

  if (name === 'mcp_cache_file') {
    const { fileName, content } = args;
    const cached = cacheFile(fileName, content);
    return {
      content: [{ type: 'text', text: `File '${cached.fileName}' cached successfully in MCP storage.` }]
    };
  }

  if (name === 'mcp_classify_design_intent') {
    const intent = classifyDesignIntent(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(intent, null, 2) }] };
  }

  if (name === 'mcp_generate_design_schema') {
    if (!args?.designType || !Array.isArray(args.userCopyTexts) || args.userCopyTexts.length === 0) {
      throw new Error('designType and userCopyTexts[] are required.');
    }
    const design = await generateDesignSchema(args, { id: 'mcp_stdio_user', username: 'mcp-stdio' });
    const cached = cacheFile(`${design.id}.schema.json`, JSON.stringify(design, null, 2));
    return { content: [{ type: 'text', text: JSON.stringify({ designId: design.id, mode: design.mode, slideCount: design.slides.length, cachePath: cached.path, intent: design.intent }, null, 2) }] };
  }

  if (name === 'mcp_get_integration_status') {
    const status = await getIntegrationStatus();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Connect stdio transport if running directly in an LLM context
if (process.argv.includes('--stdio')) {
  const transport = new StdioServerTransport();
  mcpServer.connect(transport).then(() => {
    console.error('[MCP Server] Stdio server connected.');
  }).catch(err => {
    console.error('[MCP Server] Failed to connect Stdio transport:', err);
  });
}
