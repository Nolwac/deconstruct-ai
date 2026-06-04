# Deconstruct AI 📐🤖

An AI-powered graphic design automation tool that extracts structural layout guidelines, design rules, and visual style schemas from reference designs (thumbnails, carousels, flyers) to generate cohesive new designs using your own assets (images, copies, etc.).

This project is built using a hybrid architecture integrating **n8n** (Orchestration & Workflow Engine), **Flowise** (AI Multi-Agent & LLM Logic), **Pinecone** (Vector Memory Store), and **MCP** (Model Context Protocol).

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
|   |                           { Is Template ID Present? }                     |
|   |                            /                       \                      |
|   |                         (No)                      (Yes)                   |
|   |                          /                           \                    |
|   |                         v                             v                   |
|   |               [ LLM Extract Style ]          [ Pinecone Index Query ]     |
|   |               (Generates JSON Rule)          (Fetches existing rule)      |
|   |                         |                             |                   |
|   |                         v                             |                   |
|   |               [ Pinecone Vector Store ] <-------------+                   |
|   |               (Upsert new JSON rule)                                      |
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
- When image generation is enabled, final images must come from the n8n/Flowise/Gemini workflow only; the app must not synthesize final images locally.
- `ENABLE_EXTERNAL_INTEGRATION_CHECKS=false` keeps verification local unless explicitly enabled.
- Pinecone credentials are optional. Without them, the app reports local memory-only mode.

### 2. Start the local stack with Docker Compose

```bash
docker compose up app mcp-server flowise n8n
```

Local URLs:
- App: `http://localhost:5000`
- MCP HTTP server: `http://localhost:5001/mcp/status`
- Flowise: `http://localhost:3000`
- n8n: `http://localhost:5678`

The app container uses Docker-internal URLs for service-to-service calls (`mcp-server`, `flowise`, `n8n`) while the same ports remain exposed on localhost for browser/manual setup.

### 3. Import Flowise and n8n assets

Flowise:
1. Open `http://localhost:3000`.
2. Click **Add New** ➔ **Load Chatflow** and upload `flowise/deconstruct-ai-flowise-chatflow.json`.
3. Configure optional credentials only when you intentionally enable real model/Pinecone calls.
4. Save the chatflow and copy its Chatflow ID into `.env.local` as `FLOWISE_CHATFLOW_ID`.

n8n:
1. Open `http://localhost:5678`.
2. Import or paste `n8n/deconstruct-ai-n8n-workflow.json`.
3. Set Flowise prediction URL to `http://flowise:3000/api/v1/prediction/<FLOWISE_CHATFLOW_ID>` when running inside Docker, or `http://localhost:3000/api/v1/prediction/<FLOWISE_CHATFLOW_ID>` when running n8n on the host.
4. Keep paid image/model credential nodes disabled until real generation is explicitly approved.

### 4. Local verification

```bash
npm test
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

The system will route, analyze, save/load from Pinecone, construct a detailed prompt, generate the asset, and return a binary `image/png` response directly to your WebUI.
