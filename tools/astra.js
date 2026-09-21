#!/usr/bin/env node
// Dev-time helper: lets Claude (or you) ask the Astra / OpenAI model a
// question about this project from the terminal. Not part of the CRM
// server — nothing in server/ or js/ requires this file.
//
//   node tools/astra.js "review this function" server/lpMapping.js
//   echo "question" | node tools/astra.js - path/to/file.js
//
// First arg is the prompt ("-" = read it from stdin); remaining args are
// files whose contents are attached as context. Reads OPENAI_API_KEY /
// OPENAI_MODEL / OPENAI_BASE_URL from the project-root .env.

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is empty — paste your key into .env first.');
  process.exit(1);
}
const model = process.env.OPENAI_MODEL || 'gpt-4o';
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

async function main() {
  const [promptArg, ...files] = process.argv.slice(2);
  if (!promptArg) {
    console.error('Usage: node tools/astra.js "<prompt>" [file ...]   (use - to read the prompt from stdin)');
    process.exit(1);
  }
  const prompt = promptArg === '-' ? fs.readFileSync(0, 'utf8') : promptArg;

  const context = files
    .map(f => `--- ${f} ---\n${fs.readFileSync(path.resolve(f), 'utf8')}`)
    .join('\n\n');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are Astra, a senior engineer collaborating with Claude on the Turan Capital fund CRM (Node/Express + SQLite backend, vanilla-JS frontend). Be concrete and concise; reference file names and line numbers where relevant.' },
        { role: 'user', content: context ? `${prompt}\n\n${context}` : prompt },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    // exitCode, not process.exit(): exiting with a fetch handle still
    // closing trips a libuv assertion on Windows.
    process.exitCode = 1;
    return;
  }
  const body = await res.json();
  console.log(body.choices?.[0]?.message?.content || '');
}

main().catch(e => { console.error(e.message); process.exit(1); });
