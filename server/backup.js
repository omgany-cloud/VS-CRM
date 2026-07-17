// Automated backups for server/data/crm.sqlite — there was previously no
// backup strategy at all; a corrupted or lost file meant losing every
// LP/fund/deal/document record with no way back.
//
// Uses SQLite's own `VACUUM INTO` (not a raw file copy) — this is SQLite's
// atomic-snapshot mechanism, safe to run against a live database even in
// WAL mode with concurrent readers/writers (server/db.js enables WAL via
// `PRAGMA journal_mode = WAL`), unlike copying the .sqlite file directly
// which can capture a torn/inconsistent state.
const path = require('path');
const fs = require('fs');
const { db } = require('./db');

const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const RETENTION_DAYS = 30;

function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `crm-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.startsWith('crm-') || !f.endsWith('.sqlite')) continue;
    const full = path.join(BACKUP_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }
  return target;
}

// Called once at server startup (immediate safety net) and then on this
// interval for as long as the process stays up.
function scheduleBackups(intervalHours = 6) {
  setInterval(() => {
    try { runBackup(); } catch (err) { console.error('[backup] scheduled backup failed:', err.message); }
  }, intervalHours * 60 * 60 * 1000);
}

module.exports = { runBackup, scheduleBackups, BACKUP_DIR };

// Allow `node server/backup.js` as a standalone on-demand backup.
if (require.main === module) {
  try {
    const target = runBackup();
    console.log('Backup written to', target);
  } catch (err) {
    console.error('Backup failed:', err.message);
    process.exit(1);
  }
}
