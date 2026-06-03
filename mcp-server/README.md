# MCP Server Configuration

This directory contains the local Deconstruct AI MCP-compatible HTTP + stdio service.

## What it exposes

HTTP endpoints:

- `GET /mcp/status` — local health/status for app, n8n, and verification wiring.
- `POST /mcp/log` — append an audit event to `logs/mcp_activity.log`.
- `POST /mcp/cache` — cache generated artifacts or schema snippets under `logs/cache/`.

Stdio tools:

- `mcp_log_event`
- `mcp_cache_file`

## Local run

From the repository root:

```bash
npm install
npm run dev:all
```

Or run only the MCP HTTP server:

```bash
cd mcp-server
npm install
npm start
```

The HTTP server listens on `http://localhost:5001` by default. Override with `MCP_PORT`.

## Verification

With the MCP server running:

```bash
npm run verify:mcp
```

The verification is local-only and writes a small test audit/cache file under `logs/`.
