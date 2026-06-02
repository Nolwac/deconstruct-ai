# MCP Server Configuration

This directory contains specifications and logs for the Model Context Protocol (MCP) server layer used by Deconstruct AI.

## Overview

The MCP layer bridges the cloud-based orchestration (n8n & Flowise) with local operations on the hosting environment (VPS or local workstation).

The n8n orchestrator sends a request to the MCP server at `http://localhost:5001/mcp/log` for:
- Saving local logs of templates and design requests.
- Caching generated layouts and backing up assets.
- Checking local system resources.

## Quick Start (Mock Server setup)

To spin up a basic Express receiver for the MCP logs:

1. In this directory, run:
   ```bash
   npm init -y
   npm install express
   ```

2. Create a basic `index.js`:
   ```javascript
   const express = require('express');
   const fs = require('fs');
   const path = require('path');
   const app = express();
   app.use(express.json());

   app.post('/mcp/log', (req, res) => {
     console.log('Received MCP log payload:', req.body);
     const logLine = `${new Date().toISOString()} - ${JSON.stringify(req.body)}\n`;
     fs.appendFileSync(path.join(__dirname, 'mcp_activity.log'), logLine);
     res.status(200).json({ status: 'success', message: 'Log recorded locally by MCP' });
   });

   app.listen(5001, () => {
     console.log('MCP Local Handler listening on port 5001');
   });
   ```

3. Run the mock handler:
   ```bash
   node index.js
   ```
