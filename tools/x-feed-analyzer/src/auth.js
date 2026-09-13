import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';
import { config, requireClientId } from './config.js';

const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const SCOPES = ['tweet.read', 'users.read', 'offline.access'];

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makePkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function authHeader() {
  // Confidential clients authenticate with HTTP Basic auth on the token
  // endpoint; public clients (PKCE-only, no secret) send client_id in the body.
  if (!config.clientSecret) return null;
  const raw = `${config.clientId}:${config.clientSecret}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

async function exchangeCodeForToken(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  if (!config.clientSecret) body.set('client_id', config.clientId);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const auth = authHeader();
  if (auth) headers.Authorization = auth;

  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (!config.clientSecret) body.set('client_id', config.clientId);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const auth = authHeader();
  if (auth) headers.Authorization = auth;

  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function saveTokens(tokenResponse) {
  const record = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    scope: tokenResponse.scope,
    obtained_at: Date.now(),
    expires_in: tokenResponse.expires_in,
  };
  fs.writeFileSync(config.tokensFile, JSON.stringify(record, null, 2));
  return record;
}

function loadTokens() {
  if (!fs.existsSync(config.tokensFile)) return null;
  return JSON.parse(fs.readFileSync(config.tokensFile, 'utf8'));
}

function isExpired(tokens) {
  const expiresAt = tokens.obtained_at + tokens.expires_in * 1000;
  return Date.now() > expiresAt - 60_000; // refresh 1 minute early
}

/** Runs the interactive PKCE authorization-code flow and persists tokens.json. */
export async function runAuthFlow() {
  requireClientId();
  const { verifier, challenge } = makePkcePair();
  const state = base64url(crypto.randomBytes(16));

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('\nOpen this URL in a browser signed into the X account you want to read,');
  console.log('and approve access:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting for the redirect back to ${config.redirectUri} ...\n`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, config.redirectUri);
      if (reqUrl.pathname !== new URL(config.redirectUri).pathname) {
        res.writeHead(404).end();
        return;
      }
      const returnedState = reqUrl.searchParams.get('state');
      const returnedCode = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
      } else if (returnedState !== state) {
        res.end('<h1>State mismatch</h1><p>Possible CSRF, aborting.</p>');
      } else {
        res.end('<h1>Authorized</h1><p>You can close this tab and return to the terminal.</p>');
      }

      server.close();
      if (error) reject(new Error(`Authorization denied: ${error}`));
      else if (returnedState !== state) reject(new Error('OAuth state mismatch'));
      else resolve(returnedCode);
    });
    server.listen(config.callbackPort);
  });

  const tokenResponse = await exchangeCodeForToken(code, verifier);
  saveTokens(tokenResponse);
  console.log('Saved tokens to tokens.json. You can now run `npm run analyze`.');
}

/** Returns a valid access token, refreshing it first if it has expired. */
export async function getAccessToken() {
  requireClientId();
  let tokens = loadTokens();
  if (!tokens) {
    throw new Error('No tokens.json found. Run `npm run auth` first.');
  }
  if (isExpired(tokens)) {
    if (!tokens.refresh_token) {
      throw new Error('Access token expired and no refresh_token was granted. Run `npm run auth` again.');
    }
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    tokens = saveTokens({ ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token });
  }
  return tokens.access_token;
}
