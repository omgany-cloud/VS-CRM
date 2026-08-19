# Deployment Guide

Runbook for deploying this app (CRM + public marketing site) to a Linux
VPS. Written for an IT team doing the deploy — follow the steps in order.

## What you're deploying

One Node.js process (`server/index.js`) serves everything:
- **CRM** — `index.html`, behind login, where staff manage funds/LPs/deals/etc.
- **LP portal** — `portal.html`, behind a separate per-company login.
- **Public marketing site** — `company.html` (also served at the bare
  domain `/` — see step 10), a single page (company info, team, contact) —
  no login required, meant for the public internet.
- **API** — everything under `/api/...`, used by all three of the above.

All of it comes from a single SQLite database file
(`server/data/crm.sqlite`) on local disk — no external database server to
provision.

## Prerequisites

- A Linux VPS running **Ubuntu Server 24.04 LTS or 26.04 LTS** (these steps
  are apt-based; ask us for the CentOS/Alma equivalents if you're running
  something else).
- Root or sudo SSH access to it.
- A domain name with its DNS A record already pointed at the VPS's public IP
  (needed for step 8; you can do everything up through step 6 without one).
- Node.js **≥ 24.0.0** — this app uses `node:sqlite`, which needs the
  `--experimental-sqlite` flag on some 22.x builds and this app doesn't pass
  it. Node 24 doesn't need the flag at all. Don't substitute an older Node
  22.x install here even though some other guide might suggest it.

## 1. Connect and update the system

```bash
ssh user@your-server-ip
sudo apt update && sudo apt upgrade -y
```

## 2. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirm >= 24.0.0
```

## 3. Clone the repository

```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/omgany-cloud/VS-CRM.git crm
cd crm/server
sudo npm install --omit=dev
```

## 4. Configure `.env`

The app loads `.env` from the **project root** (`/var/www/crm/.env`), one
level above `server/` — not from inside `server/` itself. Get this wrong
and the app silently falls back to defaults (auto-generated JWT secret,
demo portal password) with no error telling you why.

```bash
cp ../.env.example ../.env
nano ../.env
```

Set these before going live:

| Variable | What to set it to | Why |
|---|---|---|
| `JWT_SECRET` | Output of `openssl rand -hex 64` | Signs every login session. If left unset, the server auto-generates one and stores it in `server/data/.jwt_secret` — fine for a quick test, not for production (that file sits right next to the database it's meant to protect). |
| `PORTAL_DEMO_PASSWORD` | A real password of your choosing | Defaults to a shared demo password (`PortalDemo2025!`) used by every LP portal login. Change it before any real LP gets a portal link. |
| `TRUST_PROXY` | `1` | Required once nginx sits in front (step 7). Without it, every request looks like it comes from nginx's own IP, and the login rate-limiter locks out everyone after one person mistypes their password a few times. **Leave this unset if you ever run the app directly exposed to the internet with no reverse proxy** — setting it without a real proxy in front lets a visitor fake their own IP and dodge the rate limiter entirely. |
| `PORT` | `4000` (default, can leave blank) | Port the Node process listens on internally. nginx will proxy to this. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Your SMTP provider's details (corporate relay, SendGrid, Postmark, AWS SES, ...) | Powers server/notifications/* — Capital Call/Distribution created, your turn in a workflow approval, and the KYC/document/regulator-deadline digests. Leave `SMTP_HOST` blank to keep notifications logging to the console instead of sending real email (fine for a demo/staging box, not for anyone who actually needs to receive these). |

Leave `TLS_CERT_PATH` / `TLS_KEY_PATH` blank — TLS is handled by nginx + certbot in step 8, not by the Node process directly. (If you'd rather terminate TLS in Node instead of nginx, set these two to your cert/key file paths and skip nginx's TLS config in step 8 — either approach works, just don't do both.)

## 5. Smoke-test before wiring it into anything

```bash
node index.js
```
In a second terminal:
```bash
curl http://localhost:4000/api/version
curl -o /dev/null -s -w "%{http_code}\n" http://localhost:4000/company.html
```
Both should respond. `Ctrl+C` the server once confirmed.

## 6. Run it as a systemd service

Native to Ubuntu Server, no extra tooling to install, integrates with
`journalctl`/`systemctl`, and restarts automatically on crash or reboot.

A ready-made unit file is included in the repo at `deploy/crm.service`
(assumes the paths from step 3 — adjust `WorkingDirectory`/`ExecStart` if
you cloned somewhere else):

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin crmapp
sudo chown -R crmapp:crmapp /var/www/crm
sudo cp /var/www/crm/deploy/crm.service /etc/systemd/system/crm.service
sudo systemctl daemon-reload
sudo systemctl enable --now crm
sudo systemctl status crm
```

Useful commands for later:
```bash
sudo systemctl status crm     # is it running?
sudo journalctl -u crm -f     # tail live logs
sudo systemctl restart crm    # after a deploy update (step 12)
```

(If your team already standardizes on pm2 instead, that works too —
`sudo npm install -g pm2 && pm2 start index.js --name crm && pm2 save && pm2 startup` — just don't run both process managers against the same port.)

## 7. Put nginx in front

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/crm
```

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 20M;   # matches the app's own file-upload limit

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 8. HTTPS via Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```
certbot edits the nginx config to add the 443/TLS block and sets up
auto-renewal — nothing further to do here.

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```
Do **not** open port 4000 to the internet — all traffic should go through
nginx on 80/443. Only nginx (on the same machine) talks to the Node process
directly.

## 10. What lives at the bare domain

`https://your-domain.com/` (no path) serves `company.html` — the public
marketing/landing page (company info, team, contact — a single page,
navigated via in-page anchors rather than separate URLs). The CRM login
itself is untouched and still reachable at `your-domain.com/index.html`
(linked from company.html's own "MYCRM" button in the header). This is a
server-side route override (`server/index.js`), not a page rename — no
bookmarks or internal links needed to change if you'd rather flip it back
to the CRM being the homepage; ask us if you want that instead.

## 11. First login — do not reseed

Visit `https://your-domain.com/index.html`, log in with the real admin
account already in the database (`admin@turancapital.kz` + the current
password), or create additional real users from **Команда / Пользователи**
once logged in.

No need to run `npm run seed` here — it only creates the tenant, system
roles, and the one admin login above (each `seed*()` call skips its table
if the tenant already has rows there, so it's harmless to run again, just
a no-op). It no longer generates any fictional demo business data (funds,
LPs, deals, portfolio companies) — that used to exist and was deliberately
removed from this database already; create real funds/LPs/deals through
the app itself instead.

## 12. Ongoing: deploying updates

Whenever new code is pushed to the `master` branch on GitHub:

```bash
cd /var/www/crm
sudo -u crmapp git pull origin master
cd server && sudo npm install --omit=dev   # only needed if package.json changed
sudo systemctl restart crm
```

Running `git pull` as the `crmapp` user (rather than root/sudo directly)
keeps the pulled files owned by the same user the service already runs
as — running it as root would leave newly-pulled files root-owned, which
`crmapp` then can't write to on the next deploy.

The live database (`server/data/crm.sqlite`) is untouched by a `git pull`
— it's gitignored and lives only on the server.

## 13. Backups

`server/backup.js` runs automatically inside the same process and writes
timestamped snapshots to `server/data/backups/` every 6 hours (30-day
retention). This is **still the same physical disk** as the live
database — a disk failure takes out the live DB and every local backup at
once.

### Offsite: syncing to a second Ubuntu Server

A ready-made script is included at `deploy/backup-sync.sh` — it rsyncs
`server/data/backups/` to a second server over SSH, with locking (won't
double-run if a previous sync is still copying), logging, and a real
non-zero exit code on failure so cron/monitoring can see it failed. It
does the recurring sync only; do the one-time key setup below first.

**One-time setup, on the primary server:**
```bash
# Generate a dedicated key for this (don't reuse a personal one) —
# leave the passphrase empty, this needs to run unattended from cron.
sudo -u crmapp ssh-keygen -t ed25519 -f /var/www/crm/server/data/.backup_ssh_key -N ""

# Copy the public key to the backup server (you'll need a password or
# existing key for this one-time step)
sudo -u crmapp ssh-copy-id -i /var/www/crm/server/data/.backup_ssh_key.pub backupuser@your-backup-server
```

**On the backup server**, make sure the target directory exists and is
owned by whatever user `backupuser` is:
```bash
mkdir -p /backups/crm
```

**Back on the primary server**, install the cron job:
```bash
sudo -u crmapp crontab -e
```
```cron
0 * * * * BACKUP_REMOTE_HOST=backupuser@your-backup-server BACKUP_SSH_KEY=/var/www/crm/server/data/.backup_ssh_key /var/www/crm/deploy/backup-sync.sh
```

Check it actually worked:
```bash
cat /var/www/crm/server/data/backup-sync.log
```

The remote copy mirrors the same 30-day retention as the local one
(`--delete` in the script) rather than growing forever — see the
script's comments if you'd rather keep the offsite copy indefinitely.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `curl http://localhost:4000/api/version` fails | Node process isn't running — check `sudo systemctl status crm` / `sudo journalctl -u crm -f`. |
| Service won't start, no useful error in `systemctl status` | Check `sudo journalctl -u crm -n 50` for the actual stack trace — common causes: wrong Node version (see Prerequisites), or `.env` in the wrong location (see step 4). |
| Login rate-limits everyone after one bad attempt | `TRUST_PROXY` isn't set in `.env` while nginx is in front — see step 4. |
| Public site (`company.html`) shows broken team photos | Still on temporary `genspark.ai` hosting from initial site setup — ask us to swap in permanent files once you have them. |
| 502 from nginx | Node process crashed or isn't listening on port 4000 — check `sudo journalctl -u crm -f` for the actual error. |
| Uploaded files / DB missing after a redeploy | Confirm `server/data/` wasn't accidentally deleted — it's gitignored on purpose (it holds real data, not code) but must persist across deploys. |
| `deploy/backup-sync.sh` fails with a tool-not-found error | `flock`/`rsync`/`ssh` all ship with a standard Ubuntu Server — if one's missing, something's off with the base install, not the script. |
| Backup sync fails with an SSH/auth error | Re-check the one-time `ssh-keygen`/`ssh-copy-id` setup in step 13 — test manually with `sudo -u crmapp ssh -i /var/www/crm/server/data/.backup_ssh_key backupuser@your-backup-server` to see the real error. |
