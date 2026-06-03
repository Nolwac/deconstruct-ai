const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv(projectRoot = path.join(__dirname, '..', '..')) {
  const envPath = path.join(projectRoot, '.env');
  const localEnvPath = path.join(projectRoot, '.env.local');

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  if (fs.existsSync(localEnvPath)) {
    dotenv.config({ path: localEnvPath, override: true });
  }
}

module.exports = loadEnv;
