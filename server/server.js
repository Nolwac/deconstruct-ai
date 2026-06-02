const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'deconstruct-ai-super-secret-key';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

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
  const mcpUrl = 'http://localhost:5001/mcp/log';
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
  const {
    designType,
    referenceImageUrl,
    referenceImageFile,
    userAssetUrl,
    userAssetFile,
    userCopyText,
    brandPalette
  } = req.body;

  if (!designType || !userCopyText) {
    return res.status(400).json({ message: 'Design type and caption copy text are required.' });
  }

  // Create layout rules schema simulating Flowise & Pinecone outputs
  const templateId = 'tpl_' + Math.random().toString(36).substr(2, 9);
  
  // Setup color palettes based on user selections or preset defaults
  const customPalette = brandPalette && brandPalette.length > 0
    ? brandPalette
    : ['#1e293b', '#6366f1', '#10b981', '#ffffff'];

  // Default coordinate schemas based on design dimensions
  let layoutSchema = {
    type: designType,
    canvasSize: { width: 1280, height: 720 }, // Default landscape (YouTube Thumbnail)
    palette: customPalette,
    textConfig: {
      x: 100,
      y: 360,
      fontSize: 54,
      fontWeight: 'bold',
      fontFamily: 'Outfit, sans-serif',
      color: '#ffffff',
      align: 'left',
      maxWidth: 600,
      lineHeight: 68
    },
    assetConfig: {
      x: 800,
      y: 110,
      width: 400,
      height: 500,
      borderRadius: 16
    }
  };

  // Adjust coordinates based on selected Aspect Ratios/Types
  if (designType === 'LinkedIn Carousel') {
    layoutSchema.canvasSize = { width: 1080, height: 1080 }; // Square
    layoutSchema.textConfig = {
      x: 540,
      y: 500,
      fontSize: 48,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#ffffff',
      align: 'center',
      maxWidth: 900,
      lineHeight: 64
    };
    layoutSchema.assetConfig = {
      x: 390,
      y: 120,
      width: 300,
      height: 300,
      borderRadius: 150 // Circular avatar
    };
  } else if (designType === 'Event Flyer') {
    layoutSchema.canvasSize = { width: 1080, height: 1350 }; // Portrait
    layoutSchema.textConfig = {
      x: 540,
      y: 250,
      fontSize: 60,
      fontWeight: '900',
      fontFamily: 'Outfit, sans-serif',
      color: '#ffffff',
      align: 'center',
      maxWidth: 950,
      lineHeight: 76
    };
    layoutSchema.assetConfig = {
      x: 140,
      y: 450,
      width: 800,
      height: 750,
      borderRadius: 24
    };
  } else if (designType === 'Twitter Banner') {
    layoutSchema.canvasSize = { width: 1500, height: 500 }; // Wide
    layoutSchema.textConfig = {
      x: 120,
      y: 250,
      fontSize: 46,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#ffffff',
      align: 'left',
      maxWidth: 700,
      lineHeight: 60
    };
    layoutSchema.assetConfig = {
      x: 1000,
      y: 75,
      width: 350,
      height: 350,
      borderRadius: 175
    };
  }

  // Create design project record
  const newDesign = {
    id: 'dsg_' + Math.random().toString(36).substr(2, 9),
    userId: req.user.id,
    designType,
    userCopyText,
    layoutSchema,
    templateId,
    userAssetUrl: userAssetUrl || 'Uploaded File',
    referenceImageUrl: referenceImageUrl || 'Uploaded File',
    createdAt: new Date().toISOString()
  };

  // Persist record
  const designs = readDb(DESIGNS_FILE);
  designs.push(newDesign);
  writeDb(DESIGNS_FILE, designs);

  // Log to mock MCP layer
  logToMcp('design_generated', {
    designId: newDesign.id,
    userId: req.user.id,
    templateId,
    designType
  });

  // Return the layout schema config
  res.status(200).json({
    message: 'Design generated successfully.',
    design: newDesign
  });
});

app.get('/api/designs/history', authenticateToken, (req, res) => {
  const designs = readDb(DESIGNS_FILE);
  const userDesigns = designs.filter(d => d.userId === req.user.id);
  
  // Sort by date descending
  userDesigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.status(200).json(userDesigns);
});

// Catch-all to serve UI Index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Run server
app.listen(PORT, () => {
  console.log(`Deconstruct AI Server listening on http://localhost:${PORT}`);
});
