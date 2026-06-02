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

### 1. Flowise Setup (AI Brain)
1. Launch your **Flowise** dashboard.
2. Click **Add New** ➔ **Load Chatflow** and upload `flowise/deconstruct-ai-flowise-chatflow.json`.
3. Configure your API credentials for:
   - **Vision LLM**: OpenAI API Key (using `gpt-4o` or similar vision model) or Gemini API Key.
   - **Pinecone Vector Store**: Pinecone environment credentials, Index Name (`graphics-templates`), and Namespace (`rulesets`).
4. Save the chatflow and note down your **Chatflow ID** and **API URL**.

### 2. n8n Setup (Orchestration Engine)
1. Open your **n8n** editor canvas.
2. Copy the contents of `n8n/deconstruct-ai-n8n-workflow.json` to your clipboard.
3. Paste the contents directly into the n8n workspace (`Ctrl+V` or `Cmd+V`).
4. Double-click the **Call Flowise Layer** node:
   - Update the URL with your Flowise prediction API URL (`http://localhost:3000/api/v1/prediction/YOUR_FLOWISE_CHATFLOW_ID`).
5. Double-click the **Image Generation Model Node** and link/create your OpenAI/Gemini credentials.

### 3. MCP Server Integration (Local Infrastructure)
The orchestration workflow performs a POST request to `http://localhost:5001/mcp/log`. This endpoint maps to your local Model Context Protocol (MCP) server.
- The MCP server enables the model to interact with the environment (logging workspace activity, saving files locally, or triggering local backup routines).
- For further setup information, see [mcp-server/README.md](file:///c:/Users/LivinusTuring/Projects/deconstruct-ai/mcp-server/README.md).

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
