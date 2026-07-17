// Minimal file logger — there was previously no error logging at all
// beyond whatever terminal happened to be open, which disappears the
// moment that terminal closes. No new dependency (matches this project's
// existing preference for built-in Node modules); real-time alerting
// (email/Slack) would need infrastructure that doesn't exist yet, so the
// scope here is "the error survives to a file you can check," not a
// notification pipeline.
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'data', 'logs');

function logError(err, context) {
  console.error(context ? `[${context}]` : '', err);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `error-${new Date().toISOString().slice(0, 10)}.log`);
    const line = JSON.stringify({
      at: new Date().toISOString(),
      context: context || null,
      message: err && err.message,
      stack: err && err.stack,
    }) + '\n';
    fs.appendFileSync(file, line);
  } catch (writeErr) {
    // Logging itself failing must never take the process down or mask
    // the original error — console.error above already ran regardless.
    console.error('[logger] failed to write error log:', writeErr.message);
  }
}

module.exports = { logError };
