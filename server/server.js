const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const loadEnv = require('./config/loadEnv');
const { getIntegrationStatus } = require('./services/integrations');
const { generateDesignSchema } = require('./services/generationPipeline');
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

// Ensure database files exist
const initFile = (filePath, initialData) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
  }
};
initFile(USERS_FILE, []);
initFile(DESIGNS_FILE, []);

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
    console.error('[Generation Pipeline] Failed:', error);
    res.status(500).json({ message: 'Generation pipeline failed.', error: error.message });
  }
});

app.get('/api/designs/history', authenticateToken, (req, res) => {
  const designs = readDb(DESIGNS_FILE);
  const userDesigns = designs.filter(d => d.userId === req.user.id);
  
  // Sort by date descending
  userDesigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.status(200).json(userDesigns);
});

app.get('/api/integrations/status', authenticateToken, async (_req, res) => {
  const status = await getIntegrationStatus();
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
