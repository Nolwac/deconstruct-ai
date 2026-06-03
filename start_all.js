const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const loadEnv = require('./server/config/loadEnv');

loadEnv(__dirname);

const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const processes = [];

function startProcess(name, command, args, cwd = __dirname) {
  console.log(`[Orchestrator] Starting ${name}...`);
  const logFile = fs.createWriteStream(path.join(LOGS_DIR, `${name.toLowerCase()}.log`), { flags: 'a' });

  const proc = spawn(command, args, { cwd, shell: true, env: process.env });

  proc.stdout.on('data', (data) => {
    const output = data.toString().trim();
    logFile.write(`${new Date().toISOString()} - STDOUT - ${output}\n`);
    console.log(`[${name}]: ${output}`);
  });

  proc.stderr.on('data', (data) => {
    const output = data.toString().trim();
    logFile.write(`${new Date().toISOString()} - STDERR - ${output}\n`);
    console.error(`[${name} ERROR]: ${output}`);
  });

  proc.on('close', (code) => {
    console.log(`[Orchestrator] ${name} process exited with code ${code}`);
  });

  processes.push({ name, proc });
}

function cleanup() {
  console.log('\n[Orchestrator] Terminating all background services...');
  processes.forEach(({ name, proc }) => {
    console.log(`[Orchestrator] Killing ${name}...`);
    proc.kill();
  });
  process.exit(0);
}

// Handle termination signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start all services
// 1. Deconstruct AI Web Application (Port 5000)
startProcess('WebApp', 'node', ['server/server.js']);

// 2. Hybrid MCP Server (Port 5001)
startProcess('McpServer', 'node', ['mcp-server/index.js']);

// 3. Flowise AI Chatflow Server (Port 3000)
startProcess('Flowise', 'npx', ['-y', 'flowise', 'start']);

// 4. n8n Orchestrator Server (Port 5678)
startProcess('n8n', 'npx', ['-y', 'n8n', 'start']);

console.log('[Orchestrator] All background services spawned. Press Ctrl+C to terminate all services.');
