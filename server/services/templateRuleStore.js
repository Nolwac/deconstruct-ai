const REQUIRED_RULE_SECTIONS = [
  'designIdentity',
  'canvas',
  'visualTreatment',
  'typography',
  'copyPlacement',
  'colorSystem',
  'assetRules',
  'composition',
  'buildSteps',
  'doDont',
  'prePublishChecklist',
  'qualityNotes'
];

let Pool;
try {
  ({ Pool } = require('pg'));
} catch (_) {
  Pool = null;
}

let pool = null;
let initialized = false;

function postgresEnabled() {
  return Boolean(Pool && (process.env.DATABASE_URL || process.env.POSTGRES_HOST || process.env.POSTGRES_DB));
}

function getPool() {
  if (!postgresEnabled()) return null;
  if (!pool) {
    pool = process.env.DATABASE_URL
      ? new Pool({ connectionString: process.env.DATABASE_URL })
      : new Pool({
          host: process.env.POSTGRES_HOST || 'localhost',
          port: Number(process.env.POSTGRES_PORT || 5432),
          database: process.env.POSTGRES_DB || 'deconstruct_ai',
          user: process.env.POSTGRES_USER || 'deconstruct_ai',
          password: process.env.POSTGRES_PASSWORD || 'deconstruct_ai'
        });
  }
  return pool;
}

async function ensureTemplateTable() {
  const db = getPool();
  if (!db) return false;
  if (initialized) return true;
  await db.query(`
    CREATE TABLE IF NOT EXISTS template_rules (
      template_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT,
      design_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      summary TEXT NOT NULL,
      rule_text TEXT NOT NULL,
      template_mode TEXT NOT NULL,
      source TEXT NOT NULL,
      reference_image_count INTEGER NOT NULL DEFAULT 0,
      asset_image_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE template_rules ADD COLUMN IF NOT EXISTS rule_text TEXT;
    ALTER TABLE template_rules ADD COLUMN IF NOT EXISTS style_guide JSONB;
    ALTER TABLE template_rules ADD COLUMN IF NOT EXISTS style JSONB;
    UPDATE template_rules
      SET rule_text = COALESCE(
        NULLIF(rule_text, ''),
        (style_guide -> 'aiTemplateRules')::text,
        style_guide::text,
        (style -> 'aiTemplateRules')::text,
        style::text,
        summary
      )
      WHERE rule_text IS NULL OR rule_text = '';
    ALTER TABLE template_rules ALTER COLUMN rule_text SET NOT NULL;
    ALTER TABLE template_rules DROP COLUMN IF EXISTS style_guide;
    ALTER TABLE template_rules DROP COLUMN IF EXISTS style;
    CREATE INDEX IF NOT EXISTS idx_template_rules_user_created
      ON template_rules (user_id, created_at DESC);
  `);
  initialized = true;
  return true;
}

function humanizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function stringifyValue(value, indent = '') {
  if (Array.isArray(value)) {
    return value.map(item => `${indent}- ${stringifyValue(item, `${indent}  `).trimStart()}`).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, child]) => {
        if (child && typeof child === 'object') {
          return `${indent}${humanizeKey(key)}:\n${stringifyValue(child, `${indent}  `)}`;
        }
        return `${indent}${humanizeKey(key)}: ${String(child)}`;
      })
      .join('\n');
  }
  return `${indent}${value == null ? '' : String(value)}`;
}

function objectToRuleText(rules) {
  if (!rules) return '';
  if (typeof rules === 'string') {
    const trimmed = rules.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return objectToRuleText(JSON.parse(trimmed));
      } catch (_) {
        return trimmed;
      }
    }
    return trimmed;
  }
  return Object.entries(rules)
    .map(([section, value]) => `## ${humanizeKey(section)}\n${stringifyValue(value).trim()}`)
    .join('\n\n')
    .trim();
}

function extractRuleText(template) {
  return objectToRuleText(
    template?.ruleText ||
    template?.rulesText ||
    template?.styleGuide?.aiTemplateRulesText ||
    template?.style?.aiTemplateRulesText ||
    template?.styleGuide?.aiTemplateRules ||
    template?.style?.aiTemplateRules ||
    template?.styleGuide ||
    template?.style ||
    ''
  );
}

function serializeTemplate(template) {
  const ruleText = extractRuleText(template);
  return {
    templateId: template.templateId,
    userId: template.userId,
    username: template.username || null,
    designType: template.designType,
    mode: template.mode,
    summary: template.summary,
    ruleText,
    styleGuide: { ...(template.styleGuide || {}), aiTemplateRulesText: ruleText },
    style: { ...(template.style || {}), aiTemplateRulesText: ruleText },
    templateMode: template.templateMode,
    source: template.source,
    referenceImageCount: Number(template.referenceImageCount || 0),
    assetImageCount: Number(template.assetImageCount || 0),
    createdAt: template.createdAt || new Date().toISOString(),
    updatedAt: template.updatedAt || template.createdAt || new Date().toISOString()
  };
}

function rowToTemplate(row) {
  return serializeTemplate({
    templateId: row.template_id,
    userId: row.user_id,
    username: row.username,
    designType: row.design_type,
    mode: row.mode,
    summary: row.summary,
    ruleText: row.rule_text,
    templateMode: row.template_mode,
    source: row.source,
    referenceImageCount: row.reference_image_count,
    assetImageCount: row.asset_image_count,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  });
}

function getTemplateRules(template) {
  return extractRuleText(template) || null;
}

function assessTemplateRuleQuality(rules) {
  const text = objectToRuleText(rules);
  const lower = text.toLowerCase();
  const aliases = {
    doDont: ['do dont', 'do / dont', 'do / don’t', 'do / don\'t', 'do/dont', 'do/don’t', 'do/don\'t'],
    prePublishChecklist: ['pre publish checklist', 'pre-publish checklist', 'prepublish checklist']
  };
  const present = REQUIRED_RULE_SECTIONS.filter(key => {
    const normalized = humanizeKey(key).toLowerCase();
    const candidates = [key.toLowerCase(), normalized, ...(aliases[key] || [])];
    return candidates.some(candidate => lower.includes(candidate));
  });
  return {
    score: present.length,
    requiredCount: REQUIRED_RULE_SECTIONS.length,
    present,
    missing: REQUIRED_RULE_SECTIONS.filter(key => !present.includes(key)),
    characterCount: text.length,
    lineCount: text ? text.split(/\r?\n/).length : 0,
    richEnough: present.length >= 10 && text.length >= 2400,
    requiredSections: REQUIRED_RULE_SECTIONS,
    benchmark: 'full-template-reference-rule-depth',
    storageFormat: 'plain-multiline-text'
  };
}

async function listTemplatesForUser(userId, designs = []) {
  try {
    if (!(await ensureTemplateTable())) {
      return { templates: [], source: 'postgres', error: 'PostgreSQL template-rule storage is not configured.' };
    }
    const result = await getPool().query('SELECT * FROM template_rules WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return { templates: result.rows.map(rowToTemplate), source: 'postgres' };
  } catch (error) {
    return { templates: [], source: 'postgres', error: error.message };
  }
}

async function getTemplateForUser(templateId, userId, designs = []) {
  if (!templateId) return { template: null, source: 'none' };
  try {
    if (!(await ensureTemplateTable())) {
      return { template: null, source: 'postgres', error: 'PostgreSQL template-rule storage is not configured.' };
    }
    const result = await getPool().query('SELECT * FROM template_rules WHERE template_id = $1 AND user_id = $2 LIMIT 1', [templateId, userId]);
    return { template: result.rows[0] ? rowToTemplate(result.rows[0]) : null, source: 'postgres' };
  } catch (error) {
    return { template: null, source: 'postgres', error: error.message };
  }
}

async function upsertTemplate(template) {
  const record = serializeTemplate(template);
  try {
    if (!(await ensureTemplateTable())) {
      return { attempted: true, ok: false, source: 'postgres', templateId: record.templateId, error: 'PostgreSQL template-rule storage is not configured.', storageFormat: 'plain-multiline-text' };
    }
    await getPool().query(`
        INSERT INTO template_rules (
          template_id, user_id, username, design_type, mode, summary, rule_text,
          template_mode, source, reference_image_count, asset_image_count, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,NOW())
        ON CONFLICT (template_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          username = EXCLUDED.username,
          design_type = EXCLUDED.design_type,
          mode = EXCLUDED.mode,
          summary = EXCLUDED.summary,
          rule_text = EXCLUDED.rule_text,
          template_mode = EXCLUDED.template_mode,
          source = EXCLUDED.source,
          reference_image_count = EXCLUDED.reference_image_count,
          asset_image_count = EXCLUDED.asset_image_count,
          updated_at = NOW()
      `, [
        record.templateId,
        record.userId,
        record.username,
        record.designType,
        record.mode,
        record.summary,
        record.ruleText,
        record.templateMode,
        record.source,
        record.referenceImageCount,
        record.assetImageCount,
        record.createdAt
      ]);
    return { attempted: true, ok: true, source: 'postgres', templateId: record.templateId, storageFormat: 'plain-multiline-text' };
  } catch (error) {
    return { attempted: true, ok: false, source: 'postgres', templateId: record.templateId, error: error.message, storageFormat: 'plain-multiline-text' };
  }
}

async function deleteTemplateForUser(templateId, userId, designs = []) {
  const existing = await getTemplateForUser(templateId, userId, designs);
  if (!existing.template) return { deleted: false, source: existing.source, error: existing.error || null };
  try {
    if (!(await ensureTemplateTable())) {
      return { deleted: false, source: 'postgres', error: 'PostgreSQL template-rule storage is not configured.' };
    }
    await getPool().query('DELETE FROM template_rules WHERE template_id = $1 AND user_id = $2', [templateId, userId]);
    return { deleted: true, source: 'postgres' };
  } catch (error) {
    return { deleted: false, source: 'postgres', error: error.message };
  }
}

async function getPostgresStatus() {
  const configured = postgresEnabled();
  if (!configured) {
    return { name: 'postgres', configured: false, ok: false, mode: 'required-authoritative-template-rules', error: 'PostgreSQL is not configured; set DATABASE_URL or POSTGRES_* variables.' };
  }
  try {
    await ensureTemplateTable();
    const result = await getPool().query('SELECT COUNT(*)::int AS count FROM template_rules');
    return { name: 'postgres', configured: true, ok: true, mode: 'authoritative-template-rules', templateCount: result.rows[0]?.count || 0, ruleFieldType: 'TEXT', error: null };
  } catch (error) {
    return { name: 'postgres', configured: true, ok: false, mode: 'required-authoritative-template-rules', error: error.message };
  }
}

module.exports = {
  REQUIRED_RULE_SECTIONS,
  assessTemplateRuleQuality,
  getTemplateRules,
  listTemplatesForUser,
  getTemplateForUser,
  upsertTemplate,
  deleteTemplateForUser,
  getPostgresStatus,
  objectToRuleText
};
