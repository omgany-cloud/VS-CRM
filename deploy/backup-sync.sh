#!/usr/bin/env bash
# Syncs server/data/backups/ (written every 6h by server/backup.js) to a
# second Ubuntu Server over SSH — the offsite half of the backup strategy
# from DEPLOYMENT.md #13. server/backup.js's own snapshots are the same
# physical disk as the live database; this script is what actually gets a
# copy off that disk. Meant to run from cron on the primary server, not
# invoked by hand.
#
# Requires SSH key-based (passwordless) auth already set up from this
# server's deploy user to the backup host — see DEPLOYMENT.md's "Offsite
# backups" section for the one-time ssh-keygen/ssh-copy-id steps. This
# script only does the recurring sync, not that setup.
set -euo pipefail

# ---- Configuration — set these in the environment (e.g. cron's own
# environment, or `source`d from a small env file before this script) ----
SOURCE_DIR="${BACKUP_SOURCE_DIR:-/var/www/crm/server/data/backups}"
REMOTE_HOST="${BACKUP_REMOTE_HOST:?Set BACKUP_REMOTE_HOST, e.g. backupuser@backup-host.example.com}"
REMOTE_DIR="${BACKUP_REMOTE_DIR:-/backups/crm}"
SSH_KEY="${BACKUP_SSH_KEY:-}"
# Defaults to inside server/data/ rather than /var/log/ — that directory
# is already owned by the crmapp service user (see DEPLOYMENT.md step 6),
# whereas creating a brand-new file directly under /var/log/ typically
# needs root. Override BACKUP_SYNC_LOG if you'd rather use real syslog.
LOG_FILE="${BACKUP_SYNC_LOG:-/var/www/crm/server/data/backup-sync.log}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/crm-backup-sync.lock}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }

for tool in flock rsync ssh; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "ERROR: '$tool' not found on PATH. All three (flock, rsync, ssh) ship with a standard Ubuntu Server install — if one's missing, something's wrong with this environment, not with this script's logic."
    exit 1
  fi
done

# Prevent overlapping runs — if a previous sync is still copying (e.g. a
# slow/flaky link to the backup host outlasting the cron interval), a
# second cron-triggered run would race the first over the same files.
# Only reachable once we already know `flock` itself exists (checked
# above), so a failure here unambiguously means the lock is genuinely
# held by another run, not a missing tool.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Another sync is already running (lock held on $LOCK_FILE) — skipping this run."
  exit 0
fi

if [ ! -d "$SOURCE_DIR" ]; then
  log "ERROR: source directory $SOURCE_DIR does not exist. Is server/backup.js actually running (check 'pm2 logs crm' / 'journalctl -u crm')?"
  exit 1
fi

# BatchMode=yes: never sit waiting on an interactive password prompt if
# key auth isn't set up correctly — fail fast with a clear log line
# instead of a cron job hanging silently forever.
SSH_CMD="ssh -o BatchMode=yes -o ConnectTimeout=10"
if [ -n "$SSH_KEY" ]; then
  SSH_CMD="$SSH_CMD -i $SSH_KEY"
fi

log "Starting sync: $SOURCE_DIR -> $REMOTE_HOST:$REMOTE_DIR"
# --delete mirrors server/backup.js's own 30-day local retention onto the
# remote copy too, rather than letting the offsite copy grow forever —
# if that's not what you want, drop --delete and prune the remote side
# separately.
if rsync -az --delete -e "$SSH_CMD" "$SOURCE_DIR/" "$REMOTE_HOST:$REMOTE_DIR/" >>"$LOG_FILE" 2>&1; then
  log "Sync succeeded."
else
  status=$?
  log "ERROR: rsync failed with exit code $status — see $LOG_FILE for details."
  exit "$status"
fi
