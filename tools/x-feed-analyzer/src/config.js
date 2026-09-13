import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

export const config = {
  root,
  tokensFile: path.join(root, 'tokens.json'),
  reportFile: path.join(root, 'report.json'),
  clientId: process.env.X_CLIENT_ID || '',
  clientSecret: process.env.X_CLIENT_SECRET || '',
  redirectUri: process.env.X_REDIRECT_URI || 'http://127.0.0.1:8787/callback',
  callbackPort: Number(process.env.OAUTH_CALLBACK_PORT || 8787),
  maxPages: Number(process.env.MAX_PAGES || 5),
};

export function requireClientId() {
  if (!config.clientId) {
    throw new Error(
      'X_CLIENT_ID is not set. Copy .env.example to .env and fill it in first.'
    );
  }
}
