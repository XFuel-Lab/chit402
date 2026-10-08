const fs = require('fs');
const path = require('path');

function loadDeployEnv() {
  const local = path.join(__dirname, 'aws-env.local.json');
  if (!fs.existsSync(local)) return;
  const parsed = JSON.parse(fs.readFileSync(local, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (value == null || value === '') continue;
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = String(value);
    }
  }
}

function requireEnv(name) {
  loadDeployEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Set ${name} in the environment or services/sp1-prover/aws-env.local.json (untracked).`,
    );
  }
  return value;
}

module.exports = { loadDeployEnv, requireEnv };
