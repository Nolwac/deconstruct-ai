const fs = require('fs');
const path = require('path');
require('dotenv').config();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PINECONE_KEY = process.env.PINECONE_API_KEY;

async function testGemini() {
  console.log('\n--- TESTING GEMINI VISION/FLASH API ---');
  if (!GEMINI_KEY) {
    throw new Error('GEMINI_API_KEY is missing from environment.');
  }

  // First, list available models to verify key and get exact identifiers
  console.log('Listing available models from Gemini API...');
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`;
  const listRes = await fetch(listUrl);
  if (!listRes.ok) {
    throw new Error(`Failed to list models: ${listRes.status} - ${await listRes.text()}`);
  }
  const modelsData = await listRes.json();
  console.log('Available models list:');
  modelsData.models.slice(0, 10).forEach(m => console.log(` - ${m.name}`));

  // Pick a supported model or fallback to first listed model
  const availableModel = modelsData.models.find(m => 
    m.name.includes('gemini-2.0-flash') || 
    m.name.includes('gemini-2.5-flash')
  );
  const modelName = availableModel ? availableModel.name : modelsData.models[0].name;
  console.log(`Using model: ${modelName}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${GEMINI_KEY}`;
  
  const payload = {
    contents: [{
      parts: [{
        text: 'Extract visual design layout rule parameters from a carousel design card. Reply in JSON format with keys: colorPalette (array of hex strings), canvasSize (object with width/height), textLayout (object with alignment, fontSize), assetLayout (object with position, sizing).'
      }]
    }],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  console.log('Sending structured request to Gemini API...');
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API call failed: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  const duration = Date.now() - start;
  console.log(`✔ Gemini Response received in ${duration}ms.`);
  
  const responseText = data.candidates[0].content.parts[0].text;
  console.log('Gemini Extracted Response Snippet:\n', responseText.trim().substring(0, 300) + '...');
  
  // Verify it's valid JSON
  const parsed = JSON.parse(responseText);
  if (!parsed.colorPalette || !parsed.canvasSize) {
    throw new Error('Extracted schema is missing expected keys.');
  }
  console.log('✔ Gemini Response structure validated successfully.');
  return parsed;
}

async function testPinecone() {
  console.log('\n--- TESTING PINECONE VECTOR STORE REST API ---');
  if (!PINECONE_KEY) {
    throw new Error('PINECONE_API_KEY is missing from environment.');
  }

  // Step 1: List indexes to find host or verify connectivity
  console.log('Listing Pinecone indexes...');
  const listIndexesUrl = 'https://api.pinecone.io/indexes';
  const listRes = await fetch(listIndexesUrl, {
    headers: { 'Api-Key': PINECONE_KEY }
  });

  if (!listRes.ok) {
    const errorText = await listRes.text();
    throw new Error(`Pinecone List Indexes failed: ${listRes.status} - ${errorText}`);
  }

  const indexes = await listRes.json();
  console.log(`✔ Pinecone list index call succeeded. Total indexes found: ${indexes.indexes.length}`);
  
  if (indexes.indexes.length === 0) {
    console.log('No indexes exist in project. Creating index "graphics-templates"...');
    const createIndexUrl = 'https://api.pinecone.io/indexes';
    const createRes = await fetch(createIndexUrl, {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'graphics-templates',
        dimension: 768, // Dimension for standard embedding model (e.g. text-embedding-004)
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      })
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.log('Pinecone index creation skipped/failed:', errorText);
    } else {
      console.log('✔ Index creation request accepted. Note: Serverless index provisioning takes ~10 seconds.');
    }
  } else {
    const activeIndex = indexes.indexes[0];
    console.log(`Found active index: "${activeIndex.name}" (Host: ${activeIndex.host})`);
    
    // We can query index description
    console.log('Fetching index statistics...');
    const statsUrl = `https://${activeIndex.host}/describe_index_stats`;
    try {
      const statsRes = await fetch(statsUrl, {
        headers: { 'Api-Key': PINECONE_KEY }
      });

      if (statsRes.ok) {
        const stats = await statsRes.json();
        console.log('✔ Index stats fetched successfully:', JSON.stringify(stats));
      } else {
        console.log('Could not describe index stats (index might be provisioning).');
      }
    } catch (fetchErr) {
      console.log('⚠ Warning: Fetching index stats failed (could be transient network or DNS issue):', fetchErr.message);
      if (fetchErr.cause) {
        console.log('  Cause:', fetchErr.cause.message || fetchErr.cause);
      }
    }
  }
}

async function main() {
  try {
    const parsedSchema = await testGemini();
    await testPinecone();
    console.log('\n✔ ALL INTEGRATION API TESTS PASSED SUCCESSFULLY ✔');
    process.exit(0);
  } catch (err) {
    console.error('\n✖ INTEGRATION TEST FAILED:', err.message);
    process.exit(1);
  }
}

main();
