# Deconstruct AI Implementation Plan

## Goal
Ship a working API-first design-generation platform that accepts one or more reference images, one or more asset images, and supplied text; classifies single-design vs carousel intent; produces AI-generated final images through n8n/Flowise/Gemini only; integrates with Pinecone and local MCP-style tools for metadata/audit support; and is verified with automated and live browser tests.

## Constraints
- Do not burn the limited Gemini API budget during development. Keep AI image generation disabled unless explicitly enabled, and never substitute local synthesis for final output.
- Store secrets only in ignored local env files.
- Commit after verified milestones.
- UI must be genuinely usable: drag/drop works, no browser `alert()` UX for workflow errors, and backend/network calls are visible.

## Milestones
1. **Core API pipeline**
   - Add an explicit generation pipeline layer under `server/services`.
   - Fix slide-count logic: YouTube thumbnail stays one slide even with multiple asset images; carousel formats can produce multiple slides.
   - Store rich Flowise/Gemini orchestration metadata, template-rule evidence, generated image URLs, and warnings without client-side image-construction schemas.
   - Persist designs and local template/style memory.

2. **Integration services**
   - Add Pinecone REST upsert/query helpers with safe fallback when unavailable.
   - Add Flowise and n8n HTTP clients with local health/status exposure.
   - Add Gemini adapter behind `ENABLE_REAL_IMAGE_GENERATION=true` to protect budget.
   - Update Docker Compose/env examples for n8n + Flowise + app + MCP server.

3. **UI wiring**
   - Replace browser alerts with inline toast/status panels.
   - Implement working drag/drop for reference and asset upload zones.
   - Render multi-asset layouts on one thumbnail and carousel controls only when the backend returns multiple slides.
   - Surface integration status and generation pipeline evidence.

4. **MCP tools**
   - Expand local MCP server with tools for generating design schemas, reading integration health, and caching generated artifacts.
   - Add manual verification script for stdio tools and HTTP tool endpoints.

5. **Verification**
   - Automated API tests for thumbnail-vs-carousel classification, multi-image handling, integrations fallback, MCP tools, and history.
   - Live browser test with Playwright: register/login, drag-drop files, generate YouTube thumbnail with one reference + two assets + text, assert one slide and backend call; then carousel case asserts multiple slides.

6. **Finalization**
   - Commit each verified milestone.
   - Start n8n/Flowise/MCP/app services where possible and document exact URLs/status.
