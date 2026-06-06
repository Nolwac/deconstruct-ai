const fs = require('fs');
const path = require('path');
const {
  assessTemplateRuleQuality,
  getTemplateForUser,
  getTemplateRules,
  upsertTemplate,
  deleteTemplateForUser
} = require('./server/services/templateRuleStore');

const MEMORY_FILE = path.join(__dirname, 'server', 'template-memory.json');
const backupFile = `${MEMORY_FILE}.verify-rules-bak`;

const fullRule = `STYLE 01 — CINEMATIC BANNER / BLACK & WHITE DOCUMENTARY

DESIGN IDENTITY
Feeling: Documentary poster or vintage magazine feature.
Use for: deep-dive features, historical retrospectives, behind-the-scenes explorations, and realistic thumbnail systems.
Core principle: One strong photograph. One loud red line. Everything else gets out of the way.

CANVAS
Dimensions: 1280x720.
Aspect ratio: 16:9.
Safe zone: keep key subjects clear of bottom 60px timestamp overlay and outer 48px crop boundary.
Export: JPG under 2MB, sRGB, quality 85-92.

VISUAL TREATMENT
Use a single full-bleed wide photo with real environmental depth and expressive faces.
Grade image to black and white with saturation at 0, hard contrast, blacks RGB 5-15, whites RGB 240-250.
Add subtle film grain at 4-6% opacity only if it improves realism.
Keep lighting dramatic but photographic, never cartoon, anime, painterly, or plastic-smooth.

TYPOGRAPHY
Use heavy condensed sans type such as Anton, Bebas Neue, or Druk Wide.
Headline weight: 800-900.
Headline case: ALL CAPS.
Headline color: deep red #A32D2D to #B8322E.
Cap height: 80-95px per line, 110-130px for very short copy.
Line height: 0.9.
Tracking: -5 to -15.
Alignment: left, x=40-60px.

COPY PLACEMENT
Use the supplied words exactly. Never add, reorder, punctuate, or rewrite them.
1-2 words: single line. 3-5 words: two balanced lines. 6+ words: ask for shorter copy.
Place headline around y=220-440 so it cuts through upper torso/lower-face region, not empty sky.

COLOR SYSTEM
Only black, white, and one deep red. No secondary hue.
Allowed colors: #0A0A0A photo blacks, #F4F4F4 photo whites, #A32D2D headline red, #B8322E alternate red.

ASSET RULES
User asset image is mandatory final subject matter, not inspiration.
The asset must be integrated by AI generation into the same subject zone as the reference design.
Do not paste the uploaded asset over the generated output as a frontend overlay.
Preserve recognizable clothing/product silhouette, color family, and main visual identity unless safety rules prevent exact reproduction.

COMPOSITION
One dominant photographic field, one dominant text block, minimal clutter.
Subject should occupy 55-75% of canvas width depending on crop.
Text should overlap subject only where the reference overlaps subject.
Negative space should support headline legibility, not become empty filler.

BUILD STEPS
- Set 1280x720 canvas.
- Place and grade full-bleed photo.
- Integrate user asset as final subject using AI generation.
- Set exact supplied headline.
- Optionally distress text at 10-15%.
- Review at 240x135 thumbnail size.
- Export JPG quality 85-92.

DO / DONT
Do: one full-bleed photo; true high-contrast black and white; text crops into subject; exact supplied copy; visible user asset subject.
Dont: collages; color photo; floating text in empty space; secondary accent colors; 3+ line headline; pasted overlays; JSON formatting.

PRE-PUBLISH CHECKLIST
- Canvas is 1280x720.
- Single photo fills canvas.
- Black and white contrast with grain.
- Copy is exact.
- Headline is deep red and all caps.
- User asset is visibly integrated by AI generation.
- Design is readable at thumbnail size.

QUALITY NOTES
Rule must be plain multi-line text, not JSON, and specific enough that another designer can recreate the template without seeing the reference.`;

const otherRule = fullRule.replace('Only black, white, and one deep red. No secondary hue.', 'Use a completely different palette that must never leak into another template.');

async function main() {
  console.log('--- TEMPLATE RULE STORE VERIFICATION ---');
  if (fs.existsSync(MEMORY_FILE)) fs.copyFileSync(MEMORY_FILE, backupFile);
  fs.writeFileSync(MEMORY_FILE, '[]\n');

  try {
    await upsertTemplate({
      templateId: 'tpl_exact_a',
      userId: 'usr_rules',
      username: 'rules-user',
      designType: 'YouTube Thumbnail',
      mode: 'single',
      summary: 'Exact template A',
      ruleText: fullRule,
      templateMode: 'create-template-from-reference',
      source: 'reference-images',
      referenceImageCount: 1,
      assetImageCount: 2,
      createdAt: new Date().toISOString()
    });
    await upsertTemplate({
      templateId: 'tpl_exact_b',
      userId: 'usr_rules',
      username: 'rules-user',
      designType: 'YouTube Thumbnail',
      mode: 'single',
      summary: 'Exact template B',
      ruleText: otherRule,
      templateMode: 'create-template-from-reference',
      source: 'reference-images',
      referenceImageCount: 1,
      assetImageCount: 2,
      createdAt: new Date().toISOString()
    });

    const { template } = await getTemplateForUser('tpl_exact_a', 'usr_rules');
    if (!template) throw new Error('Template A was not retrieved by exact id.');
    const rules = getTemplateRules(template);
    if (typeof rules !== 'string') throw new Error(`Template rules must be plain text, got ${typeof rules}.`);
    if (rules.trim().startsWith('{') || rules.includes('"designIdentity"')) {
      throw new Error('Template rules are still JSON-formatted instead of plain multi-line text.');
    }
    if (!rules.includes('DESIGN IDENTITY') || !rules.includes('PRE-PUBLISH CHECKLIST')) {
      throw new Error('Template rule text is missing expected human-readable sections.');
    }
    if (rules.includes('completely different palette')) {
      throw new Error('Template A rules were contaminated by Template B.');
    }
    const quality = assessTemplateRuleQuality(rules);
    if (!quality.richEnough || quality.missing.length || quality.storageFormat !== 'plain-multiline-text') {
      throw new Error(`Template rule quality assessment failed: ${JSON.stringify(quality)}`);
    }
    await deleteTemplateForUser('tpl_exact_a', 'usr_rules');
    const deleted = await getTemplateForUser('tpl_exact_a', 'usr_rules');
    if (deleted.template) throw new Error('Template delete did not remove exact id.');
    console.log('✔ Exact template-id retrieval, no rule mixing, plain multi-line TEXT storage, quality gates, and delete path verified.');
  } finally {
    if (fs.existsSync(backupFile)) fs.renameSync(backupFile, MEMORY_FILE);
  }
}

main().catch(error => {
  console.error('✖ TEMPLATE RULE STORE VERIFICATION FAILED:', error.message);
  if (fs.existsSync(backupFile)) fs.renameSync(backupFile, MEMORY_FILE);
  process.exit(1);
});
