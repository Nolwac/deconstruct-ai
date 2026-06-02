const express = require('express');
const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

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

  console.log(`[HTTP MCP] Caching file: ${fileName}`);
  const filePath = path.join(CACHE_DIR, fileName);
  
  // Content can be base64 image or stringified JSON
  if (content.startsWith('data:image')) {
    // base64 image data
    const base64Data = content.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(filePath, base64Data, 'base64');
  } else {
    fs.writeFileSync(filePath, content);
  }

  res.status(200).json({
    status: 'success',
    message: `File cached successfully by MCP file cache tool.`,
    path: filePath
  });
});

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
    const filePath = path.join(CACHE_DIR, fileName);
    
    if (content.startsWith('data:image')) {
      const base64Data = content.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(filePath, base64Data, 'base64');
    } else {
      fs.writeFileSync(filePath, content);
    }
    
    return {
      content: [{ type: 'text', text: `File '${fileName}' cached successfully in MCP storage.` }]
    };
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
