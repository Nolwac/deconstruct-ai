const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const loadEnv = require('./config/loadEnv');
const { getIntegrationStatus } = require('./services/integrations');
const { createTemplateRuleSchema, generateDesignSchema } = require('./services/generationPipeline');
const { listTemplatesForUser, getTemplateForUser, deleteTemplateForUser } = require('./services/templateRuleStore');
loadEnv(path.join(__dirname, '..'));

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'deconstruct-ai-super-secret-key';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/generated_images', express.static(path.join(__dirname, 'generated_images')));

// Paths to mock JSON databases
const USERS_FILE = path.join(__dirname, 'users.json');
const DESIGNS_FILE = path.join(__dirname, 'designs.json');
const TEMPLATE_MEMORY_FILE = path.join(__dirname, 'template-memory.json');

// Ensure database files exist
const initFile = (filePath, initialData) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
  }
};
initFile(USERS_FILE, []);
initFile(DESIGNS_FILE, []);
initFile(TEMPLATE_MEMORY_FILE, []);

// Utility helpers for reading/writing mock databases
const readDb = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
};

const writeDb = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// Simulated MCP Logging Handshake
const logToMcp = async (event, payload) => {
  const mcpBaseUrl = process.env.MCP_HTTP_URL || 'http://localhost:5001';
  const mcpUrl = `${mcpBaseUrl.replace(/\/$/, '')}/mcp/log`;
  console.log(`[MCP Server Simulator] Logging Event: ${event}`);
  
  // Create a local log backup in all cases
  const logDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  const logLine = `${new Date().toISOString()} - EVENT: ${event} - PAYLOAD: ${JSON.stringify(payload)}\n`;
  fs.appendFileSync(path.join(logDir, 'mcp_activity.log'), logLine);

  try {
    // Attempt sending to local running MCP daemon
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    
    await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, user_context: 'agents', data: payload }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    console.log('[MCP Server Simulator] Forwarded to external MCP server successfully.');
  } catch (err) {
    console.log('[MCP Server Simulator] External MCP server port 5001 offline (logged locally instead).');
  }
};

// Middleware: Authenticate User JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication token missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};

// ----------------------------------------------------
// Authentication Routes
// ----------------------------------------------------

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  const users = readDb(USERS_FILE);
  const userExists = users.some(u => u.username.toLowerCase() === username.toLowerCase());

  if (userExists) {
    return res.status(400).json({ message: 'Username is already taken.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password, salt);

  const newUser = {
    id: 'usr_' + Math.random().toString(36).substr(2, 9),
    username,
    password: hashedPassword,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeDb(USERS_FILE, users);

  logToMcp('user_registered', { username: newUser.username, userId: newUser.id });

  // Generate JWT token
  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '24h' });
  res.status(201).json({ token, username: newUser.username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  const users = readDb(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ message: 'Invalid username or password.' });
  }

  logToMcp('user_login', { username: user.username, userId: user.id });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.status(200).json({ token, username: user.username });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.status(200).json({ username: req.user.username, id: req.user.id });
});

// ----------------------------------------------------
// Design Generation & History Routes
// ----------------------------------------------------

app.post('/api/designs/generate', authenticateToken, async (req, res) => {
  const { designType, userCopyTexts } = req.body;

  if (!designType || !userCopyTexts || !Array.isArray(userCopyTexts) || userCopyTexts.length === 0) {
    return res.status(400).json({ message: 'Design type and caption copy texts array are required.' });
  }

  try {
    const newDesign = await generateDesignSchema(req.body, req.user);
    const designs = readDb(DESIGNS_FILE);
    designs.push(newDesign);
    writeDb(DESIGNS_FILE, designs);

    logToMcp('design_generated', {
      designId: newDesign.id,
      userId: req.user.id,
      templateId: newDesign.templateId,
      designType: newDesign.designType,
      mode: newDesign.mode,
      slideCount: newDesign.slides.length
    });

    res.status(200).json({
      message: 'Design generated successfully.',
      design: newDesign
    });
  } catch (error) {
    const failureId = 'gen_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    console.error('[Generation Pipeline] Failed:', {
      failureId,
      userId: req.user.id,
      message: error.message,
      stack: error.stack
    });
    const message = error.message || '';
    const imageRefusal = /without returning a generated image|IMAGE_OTHER|could not generate the image/i.test(message);
    const inputError = /Select a saved template rule|real asset image is required|Template rule .* was not found|has no rule text/i.test(message);
    res.status(inputError ? 400 : (imageRefusal ? 422 : 500)).json({
      message: inputError
        ? message
        : (imageRefusal
          ? 'The image provider accepted the request but did not return an image. The request failed honestly without using substitute assets or substitute rules.'
          : 'We could not generate the image right now. Please try again in a moment.'),
      code: inputError ? 'DESIGN_GENERATION_INPUT_INVALID' : (imageRefusal ? 'IMAGE_PROVIDER_RETURNED_NO_IMAGE' : 'IMAGE_GENERATION_FAILED'),
      failureId
    });
  }
});

app.get('/api/designs/history', authenticateToken, (req, res) => {
  const designs = readDb(DESIGNS_FILE);
  const userDesigns = designs.filter(d => d.userId === req.user.id);
  
  // Sort by date descending
  userDesigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.status(200).json(userDesigns);
});

// ----------------------------------------------------
// User-scoped Template Memory Routes
// ----------------------------------------------------

app.get('/api/templates', authenticateToken, async (req, res) => {
  const designs = readDb(DESIGNS_FILE);
  const { templates } = await listTemplatesForUser(req.user.id, designs);
  const userTemplates = templates
    .map(template => ({
      templateId: template.templateId,
      designType: template.designType,
      mode: template.mode,
      summary: template.summary,
      source: template.source,
      referenceImageCount: template.referenceImageCount || 0,
      assetImageCount: template.assetImageCount || 0,
      templateRuleQuality: template.ruleText ? require('./services/templateRuleStore').assessTemplateRuleQuality(template.ruleText) : null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.status(200).json(userTemplates);
});

app.post('/api/templates/generate', authenticateToken, async (req, res) => {
  const { designType } = req.body;
  if (!designType) {
    return res.status(400).json({ message: 'Design type is required to create template rules.' });
  }

  try {
    const result = await createTemplateRuleSchema(req.body, req.user);
    logToMcp('template_rule_created', {
      templateId: result.template.templateId,
      userId: req.user.id,
      designType: result.template.designType,
      referenceImageCount: result.template.referenceImageCount
    });
    res.status(201).json({ message: 'Template rules created successfully.', ...result });
  } catch (error) {
    const failureId = 'tpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    console.error('[Template Rule Pipeline] Failed:', {
      failureId,
      userId: req.user.id,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      message: 'We could not create template rules right now. Please try again in a moment.',
      code: 'TEMPLATE_RULE_GENERATION_FAILED',
      failureId
    });
  }
});

app.get('/api/templates/:templateId', authenticateToken, async (req, res) => {
  const { templateId } = req.params;
  const result = await getTemplateForUser(templateId, req.user.id);
  if (!result.template) {
    return res.status(404).json({ message: 'Template not found for this user.' });
  }
  res.status(200).json({ template: result.template });
});

app.delete('/api/templates/:templateId', authenticateToken, async (req, res) => {
  const { templateId } = req.params;
  const designs = readDb(DESIGNS_FILE);
  const result = await deleteTemplateForUser(templateId, req.user.id, designs);

  if (!result.deleted) {
    return res.status(404).json({ message: 'Template not found for this user.' });
  }

  logToMcp('template_deleted', { templateId, userId: req.user.id });
  res.status(200).json({ message: 'Template deleted successfully.', templateId });
});

app.get('/api/integrations/status', authenticateToken, async (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const publicOrigin = `${protocol}://${host}`;
  const status = await getIntegrationStatus({
    publicOrigin,
    publicUrls: {
      n8n: req.headers['x-public-n8n-url'] || null,
      flowise: req.headers['x-public-flowise-url'] || null
    }
  });
  res.status(200).json(status);
});

// Catch-all to serve UI Index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Run server
app.listen(PORT, () => {
  console.log(`Deconstruct AI Server listening on http://localhost:${PORT}`);
});
