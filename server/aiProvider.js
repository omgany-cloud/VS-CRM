// Pluggable AI provider for the onboarding AI-assist routes (ai-draft /
// ai-extract / ai-screen — server/index.js). completeJson() is the ONLY
// thing the rest of the app calls; swapping providers later means adding
// a branch below, nothing else needs to know which one is active.
//
// AI_PROVIDER is unset by default — completeJson() throws a clear error
// rather than silently no-op-ing, so a route that forgets to check for
// that error fails loudly instead of pretending to have drafted something.

async function completeJsonAnthropic({ system, prompt, schema, images }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is not set in .env");

  // Required only when AI_PROVIDER=anthropic is actually in use — not a
  // hard dependency of the rest of the app.
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const content = [{ type: 'text', text: prompt }];
  for (const img of images || []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } });
  }

  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system: `${system}\n\nRespond with ONLY a single valid JSON object matching the requested shape. No markdown code fences, no commentary before or after.`,
    messages: [{ role: 'user', content }],
  });

  const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('AI response was not valid JSON: ' + text.slice(0, 200));
  }
  return { parsed, model };
}

// Plain fetch against the OpenAI-compatible Chat Completions API — no SDK
// dependency. OPENAI_BASE_URL is optional and lets this point at any
// OpenAI-compatible endpoint instead of api.openai.com (e.g. a proxy/
// gateway in front of it). Same images[] shape as the Anthropic branch
// above ({mimeType, base64}), converted to OpenAI's data-URL image format.
async function completeJsonOpenAI({ system, prompt, schema, images }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_PROVIDER is 'openai' but OPENAI_API_KEY is not set in .env");

  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

  const content = [{ type: 'text', text: prompt }];
  for (const img of images || []) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\nRespond with ONLY a single valid JSON object matching the requested shape. No markdown code fences, no commentary before or after.` },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI request failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('AI response was not valid JSON: ' + text.slice(0, 200));
  }
  return { parsed, model: body.model || model };
}

// Test-only seam — never documented in .env.example, only ever set by
// server/test/*.test.js (which spawns a real `node index.js` subprocess
// per createTestServer(), so there's no way to inject a JS-level stub
// from the test file itself). Returns whatever's in AI_STUB_RESPONSE
// verbatim; a single fixture covering every AI-assist schema's fields is
// enough since zod ignores unknown keys by default.
function completeJsonStub() {
  return { parsed: JSON.parse(process.env.AI_STUB_RESPONSE || '{}'), model: 'stub' };
}

// schema: a zod schema the parsed JSON must validate against — throws if
// the model's output doesn't match, rather than handing a route
// unvalidated shape it then trusts. images: optional [{ mimeType, base64 }]
// for Stage 2 document extraction.
async function completeJson({ system, prompt, schema, images }) {
  const provider = process.env.AI_PROVIDER;
  if (!provider) {
    throw new Error('AI is not configured — set AI_PROVIDER (and the matching API key) in .env before using AI-assist features');
  }
  let result;
  if (provider === 'anthropic') {
    result = await completeJsonAnthropic({ system, prompt, schema, images });
  } else if (provider === 'openai') {
    result = await completeJsonOpenAI({ system, prompt, schema, images });
  } else if (provider === 'stub') {
    result = completeJsonStub();
  } else {
    throw new Error(`Unknown AI_PROVIDER '${provider}' — supported: anthropic, openai`);
  }
  const data = schema ? schema.parse(result.parsed) : result.parsed;
  return { data, model: result.model };
}

module.exports = { completeJson };
