# Deconstruct AI 📐🤖

An AI-powered graphic design automation tool that extracts structural layout guidelines, design rules, and visual style schemas from reference designs (thumbnails, carousels, flyers) to generate cohesive new designs using your own assets (images, copies, etc.).

This project is built using a hybrid architecture integrating **n8n** (Orchestration & Workflow Engine), **Flowise** (AI Multi-Agent & LLM Logic), **PostgreSQL** (authoritative template-rule storage keyed by `template_id`), and **MCP** (Model Context Protocol).

---

## 🏗️ Architectural Flow

```text
                                  +-------------------------------------------------+
                                  |                 USER INTERFACE                  |
                                  |  [WebUI / Client] <--------------------------+  |
                                  +-------+--------------------------------------|--+
                                          |                                      |
                                  (1) User submits assets                        | (8) Returns final
                                      & inputs via WebUI                         |     generated design
                                          |                                      |     binary to UI
                                          v                                      |
+-----------------------------------------+--------------------------------------|--+
| n8n ORCHESTRATION LAYER                 |                                      |
|                                         v                                      |
|                                 [ n8n Webhook Node ]                           |
|                                 (POST /design-request)                         |
|                                         |                                      |
|                                         | (2) Forwards payload                 |
|                                         v                                      |
|                              [ n8n HTTP Request Node ] ------------------------+
|                                         |              ^
|                                         |              | (5) Returns extracted
|                                         |              |     or retrieved rules
|                                         v              |
|   +-------------------------------------+--------------+----------------------+
|   | FLOWISE AI LAYER                    |                                     |
|   |                                     v                                     |
|   |                             [ Flowise Chatflow ]                          |
|   |                                     |                                     |
|   |                                     v                                     |
|   |                             [ LLM Router Agent ]                          |
|   |                           (Gemini / GPT Vision)                           |
|   |                                     |                                     |
|   |                                     v                                     |
|   |                           { Exact Template ID Exists? }                   |
|   |                            /                       \                      |
|   |                         (No)                      (Yes)                   |
|   |                          /                           \                    |
|   |                         v                             v                   |
|   |               [ Vision Extract Full Rules ]  [ PostgreSQL Exact Lookup ]  |
|   |               (Generates plain text rule)    (Fetches complete rule text) |
|   |                         |                             |                   |
|   |                         v                             |                   |
|   |               [ PostgreSQL template_rules ] <---------+                   |
|   |               (Upsert new multi-line TEXT rule)                           |
|   +---------------------------------------------------------------------------+
|                                         |
|                                         | (6) Passes compiled prompt text
|                                         v
|                         [ n8n Prompt Construction Node ]
|                         (Injects text copy & asset URLs into style schema)
|                                         |
|                                         v
|                           [ n8n Image Generation Node ]
|                           (Advanced Image LLM API Call)
|                                         |
|                                         v
|                            [ n8n Deliver Response Node ]
|                                         |
+-----------------------------------------|-----------------------------------------+
                                          |
                                          | (7) Triggers local file save / logs
                                          v
+-----------------------------------------------------------------------------------+
| MCP (MODEL CONTEXT PROTOCOL) SERVER LAYER                                         |
|                                                                                   |
|      +---------------------+     Executes     +-----------------------------+     |
|      |  MCP Core Engine    | -------------->  |     MCP FileSystem Tool     |     |
|      | (Custom Node / App) |                  | (Saves production logs &    |     |
|      +---------------------+                  |  temp asset backups locally)|     |
|                                               +-----------------------------+     |
+-----------------------------------------------------------------------------------+
```

---

## 📁 Repository Structure

```text
deconstruct-ai/
├── n8n/
│   └── deconstruct-ai-n8n-workflow.json        # Importable n8n workflow file
├── flowise/
│   └── deconstruct-ai-flowise-chatflow.json    # Importable Flowise chatflow schema
├── mcp-server/
│   └── README.md                               # Information about local MCP server layer
├── .gitignore                                  # Git exclusion profiles
└── README.md                                   # Project documentation (this file)
```

---

## 🚀 Getting Started

### 1. Configure local environment

```bash
cp .env.example .env.local
# edit .env.local locally; never commit real secrets
```

Local development disables AI image generation by default:
- `ENABLE_REAL_IMAGE_GENERATION=false` prevents accidental paid model/image calls.
- When image generation is enabled, final images must come from the native n8n/Gemini workflow only; the app must not synthesize final images locally.
- `ENABLE_EXTERNAL_INTEGRATION_CHECKS=false` keeps verification local unless explicitly enabled.
- PostgreSQL is the authoritative template-rule store. Rules are saved as plain multi-line `TEXT` and retrieved by exact `template_id` plus `user_id`; vector search is not used for rule retrieval.

### 2. Start the local stack with Docker Compose

```bash
docker compose up app postgres mcp-server n8n
```

Flowise can remain available for legacy experiments, but it is not required by the primary generation path.

Local URLs:
- App: `http://localhost:5000`
- MCP HTTP server: `http://localhost:5001/mcp/status`
- Flowise: `http://localhost:3000`
- n8n: `http://localhost:5678`

The app container uses Docker-internal URLs for service-to-service calls (`mcp-server`, `n8n`, and PostgreSQL) while the same ports remain exposed on localhost for browser/manual setup.

### 3. Import the native n8n workflow

n8n:
1. Open `http://localhost:5678`.
2. Import or paste `n8n/deconstruct-ai-native-gemini-orchestrator.json` or `n8n/deconstruct-ai-live-orchestrator.json`.
3. Configure the native Google Gemini credential used by the Gemini analyze/edit nodes.
4. Keep paid image/model credential nodes disabled until real generation is explicitly approved.

Flowise:
- The primary workflow bypasses Flowise. The legacy `flowise/deconstruct-ai-flowise-chatflow.json` remains only as historical/reference material and must not be used for template-rule retrieval.

### 4. Local verification

```bash
npm test
npm run verify:template-rules
npm run verify:n8n-native
npm run verify:integrations
```

`npm run verify:integrations` checks files and local service wiring without paid API calls. For read-only external checks only, run:

```bash
ENABLE_EXTERNAL_INTEGRATION_CHECKS=true npm run verify:integrations
```

### 5. MCP Server Integration (Local Infrastructure)
The orchestration workflow performs a POST request to `http://localhost:5001/mcp/log`. This endpoint maps to the local MCP-compatible server.
- The MCP server logs workflow activity and caches generated artifacts locally.
- For further setup information, see [mcp-server/README.md](mcp-server/README.md).

---

## 💡 System Inputs & Outputs

To generate a design, send a POST payload to the n8n **Webhook Start Node** endpoint:

```json
{
  "templateId": "optional-stored-layout-id",
  "referenceImageUrl": "https://example.com/sample-layout-to-mimic.png",
  "userCopyText": "Level Up Your Coding with Deconstruct AI!",
  "userAssetUrl": "https://example.com/user-avatar-or-product.png"
}
```

The system routes through native n8n/Gemini nodes, analyzes the reference into plain multi-line rules, saves/loads complete rules through PostgreSQL by exact `template_id`, constructs a detailed prompt, generates the asset, and returns JSON containing the generated image for the WebUI to render.
