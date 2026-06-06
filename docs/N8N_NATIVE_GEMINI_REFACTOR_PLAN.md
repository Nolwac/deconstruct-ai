# n8n Native Gemini Refactor Plan

## Problem

The current workflow is not acceptable as a user-facing n8n workflow. It relies on Code nodes for work that n8n already has native nodes for, and it routes rule generation through Flowise even though the same workflow can be done directly in n8n.

Current n8n node composition:

- `Design Request Webhook` — Webhook node
- `Call Flowise Layout Rules` — Code node
- `Call Gemini Image Model` — Code node
- `Return Orchestrated Result` — Code node

This makes the workflow opaque, hard to debug from the n8n canvas, and inconsistent with the expected no-code/low-code n8n style.

## Target Architecture

Bypass Flowise entirely and move the full workflow into n8n using native nodes wherever possible.

```text
Webhook
  ↓
Normalize Request / Extract Fields
  ↓
IF: Existing Template Rule Text?
  ├─ yes → PostgreSQL: Get rule_text by template_id + user_id
  └─ no  → Google Gemini: Analyze Reference Image(s) → Plain Multi-line Rule Text
             ↓
           PostgreSQL: Upsert rule_text
  ↓
Build Image Prompt
  ↓
Convert Reference/Asset Inputs to Binary Files
  ↓
Google Gemini: Edit Image / Generate Image
  ↓
Respond to Webhook
```

## Native n8n Nodes to Use

- **Webhook** — receive generation request.
- **Edit Fields / Set** — map request fields into clean workflow variables.
- **IF** — branch between template reuse and new template analysis.
- **Postgres** — exact `template_id + user_id` lookup and `rule_text` upsert.
- **Google Gemini → Image: Analyze Image** — generate the reference-derived rule text from uploaded reference images.
- **Google Gemini → Image: Edit Image** — generate final images using asset/reference binary inputs and prompt text.
- **Respond to Webhook** — return image/result payload to the app.
- **Merge / Split Out / Item Lists** where needed for carousel slides.

## Code Node Policy

Code nodes should be removed from the main path.

If a Code node remains, it must be limited to glue that no native n8n node can reasonably express, such as converting a multi-file response shape. Even then, it should be isolated, named clearly, and documented. The target is zero Code nodes in the primary path.

## Rule Format

Rules must be plain multi-line text, not JSON and not JSON-shaped text.

PostgreSQL storage:

```sql
template_rules.rule_text TEXT NOT NULL
```

Expected rule shape:

```text
STYLE 01 — NAME

DESIGN IDENTITY
...

CANVAS
...

VISUAL TREATMENT
...

TYPOGRAPHY
...

COPY PLACEMENT
...

COLOR SYSTEM
...

ASSET RULES
...

COMPOSITION
...

BUILD STEPS
- ...

DO / DON'T
Do: ...
Don't: ...

PRE-PUBLISH CHECKLIST
- ...

QUALITY NOTES
...
```

## Flowise Decision

Remove Flowise from this workflow. There is no strong reason to keep Flowise for the current rule-generation path because n8n already has native Google Gemini image/text nodes and Postgres nodes.

Flowise should only return later if there is a concrete agent-chain use case that n8n cannot model cleanly.

## Implementation Steps

1. Create a new `n8n/deconstruct-ai-native-gemini-orchestrator.json` workflow rather than mutating blindly.
2. Add native Google Gemini credential configuration in n8n.
3. Replace Flowise rule generation with Gemini image analysis node.
4. Store/retrieve `rule_text` via native Postgres nodes.
5. Use Gemini image edit/generate native node for final image generation.
6. Update app integration to accept the native workflow response shape.
7. Remove Flowise from active Docker/app dependency after the native workflow passes tests.
8. Verify with:
   - workflow import/activation
   - direct webhook call
   - `npm test`
   - `npm run verify:template-rules`
   - `npm run verify:integrations`
   - `npm run verify:browser`

## Acceptance Criteria

- n8n canvas is understandable without opening opaque Code nodes.
- Rule generation uses Gemini native node.
- Final image generation uses Gemini native image node.
- Flowise is not called in the active path.
- Rules are plain multi-line `TEXT` in PostgreSQL.
- Template reuse retrieves exact `rule_text` by `template_id + user_id`.
- Automated and live browser tests pass.
