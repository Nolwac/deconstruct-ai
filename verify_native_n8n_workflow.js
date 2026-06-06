const fs = require('fs');
const path = require('path');

const imageWorkflowPath = path.join(__dirname, 'n8n/deconstruct-ai-live-orchestrator.json');
const nativeWorkflowPath = path.join(__dirname, 'n8n/deconstruct-ai-native-gemini-orchestrator.json');
const ruleWorkflowPath = path.join(__dirname, 'n8n/deconstruct-ai-template-rule-creator.json');

function loadWorkflow(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing workflow file: ${path.relative(__dirname, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countNodes(workflow, type) {
  return (workflow.nodes || []).filter(node => node.type === type).length;
}

function findNode(workflow, name) {
  return (workflow.nodes || []).find(node => node.name === name);
}

function main() {
  console.log('--- NATIVE GEMINI N8N SPLIT WORKFLOW CHECK ---');
  const imageWorkflow = loadWorkflow(imageWorkflowPath);
  const native = loadWorkflow(nativeWorkflowPath);
  const ruleWorkflow = loadWorkflow(ruleWorkflowPath);
  const imageText = JSON.stringify(imageWorkflow);
  const ruleText = JSON.stringify(ruleWorkflow);

  assert(countNodes(imageWorkflow, 'n8n-nodes-base.code') === 1, 'Image workflow may only contain the JSON-to-binary adapter Code node. Gemini generation must use the native node.');
  assert(countNodes(ruleWorkflow, 'n8n-nodes-base.code') === 0, 'Template-rule workflow must not contain Code nodes.');
  assert(!/flowise:3000|FLOWISE_BASE_URL|Call Flowise/i.test(imageText + ruleText), 'Workflows must not call or depend on Flowise.');

  assert(findNode(imageWorkflow, 'Design Request Webhook')?.parameters?.path === 'deconstruct-ai-generate', 'Image workflow webhook path must be deconstruct-ai-generate.');
  assert(findNode(ruleWorkflow, 'Design Request Webhook')?.parameters?.path === 'deconstruct-ai-template-rules', 'Template-rule workflow webhook path must be deconstruct-ai-template-rules.');

  assert(countNodes(ruleWorkflow, '@n8n/n8n-nodes-langchain.googleGemini') === 1, 'Template-rule workflow must use exactly one native Gemini node.');
  assert(ruleText.includes('plain multi-line template rule document'), 'Template-rule Gemini prompt must demand plain multi-line rule text.');
  assert(ruleText.includes('referenceImageUrls'), 'Template-rule workflow must analyze the reference image URL.');
  assert(!/nonexistent\.png|placeholder/i.test(ruleText), 'Template-rule workflow must not contain fallback/placeholder reference images.');

  const editNode = findNode(imageWorkflow, 'Edit Image with Gemini');
  assert(editNode, 'Image workflow must contain the native Gemini Edit Image node.');
  assert(editNode.type === '@n8n/n8n-nodes-langchain.googleGemini', 'Image generation must use the native Gemini node, not a custom Code node.');
  assert(editNode.parameters?.resource === 'image' && editNode.parameters?.operation === 'edit', 'Native Gemini node must use image/edit operation.');
  assert(editNode.parameters?.modelId?.value === 'models/gemini-3.1-flash-image', 'Native Gemini node must use the live Gemini image model.');
  assert(editNode.credentials?.googlePalmApi?.id, 'Native Gemini node must use stored n8n Gemini credentials.');
  assert(JSON.stringify(editNode.parameters?.images || {}).includes('base_canvas'), 'Native Gemini edit node must receive the generated base canvas.');
  assert(JSON.stringify(editNode.parameters?.images || {}).includes('asset_1'), 'Native Gemini edit node must receive the uploaded asset image.');
  assert(imageText.includes('n8nBinaryAssets') && imageText.includes('imagePrompt'), 'Image workflow must consume JSON body fields directly, including n8nBinaryAssets and imagePrompt.');
  assert(countNodes(imageWorkflow, 'n8n-nodes-base.httpRequest') === 0, 'Image workflow must not re-download a single asset URL; assets must arrive from the app payload.');
  assert(!findNode(imageWorkflow, 'Call Gemini Image API Directly'), 'Image workflow must not bypass the native Gemini node with a direct Code-node API call.');
  assert(!findNode(imageWorkflow, 'Download Subject Asset'), 'Image workflow must not reduce assets to one downloaded subject image.');
  assert(!findNode(imageWorkflow, 'Download Reference Design'), 'Image workflow must not download reference designs.');
  assert(!findNode(imageWorkflow, 'Generate Rule Text with Gemini'), 'Image workflow must not create template rules.');
  assert(!findNode(imageWorkflow, 'Merge Reference and Asset'), 'Image workflow must not merge reference and asset images.');
  assert(imageText.includes('templateRuleText') || imageText.includes('existingTemplateRules'), 'Image workflow must consume stored template rule text.');
  assert(imageText.includes('noFallbacks'), 'Image workflow response must expose no-fallback evidence.');
  assert(!/safeImageMode|providerBlockedAssetFallback|providerBlockedAssetFallbackUsed|placeholderAsset|retryInstructions|safe placeholder|safe retry|nonexistent\.png/i.test(imageText), 'Image workflow must not contain placeholder or safe retry paths.');
  assert(imageText.includes('usedNativeGeminiImageEditNode') && imageText.includes('nativeNodeBypassed: false'), 'Image workflow must expose native Gemini edit-node usage.');
  assert(!imageText.includes('directOpenAIApi: true'), 'Image workflow must not use direct OpenAI API generation.');
  assert(!/bodyJson|JSON\.parse\(\$json\.bodyJson\)|multipart/i.test(imageText), 'Image workflow must not depend on multipart bodyJson parsing.');
  assert(JSON.stringify(imageWorkflow.nodes) === JSON.stringify(native.nodes), 'Native image workflow file and live orchestrator file must stay in sync.');

  console.log(`✔ Image workflow nodes: ${imageWorkflow.nodes.length}`);
  console.log(`✔ Template-rule workflow nodes: ${ruleWorkflow.nodes.length}`);
  console.log(`✔ Code nodes: image=${countNodes(imageWorkflow, 'n8n-nodes-base.code')}, template=${countNodes(ruleWorkflow, 'n8n-nodes-base.code')}`);
  console.log('✔ Image generation uses native Gemini Edit Image node with stored n8n credentials.');
  console.log('✔ JSON n8nBinaryAssets are adapted into native n8n binary fields before Gemini.');
}

try {
  main();
} catch (error) {
  console.error('\n✖ NATIVE N8N SPLIT WORKFLOW CHECK FAILED:', error.message);
  process.exit(1);
}
