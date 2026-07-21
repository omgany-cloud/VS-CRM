# Deployment Guide

Runbook for deploying this app (CRM + public marketing site) to a Linux
VPS. Written for an IT team doing the deploy — follow the steps in order.

## What you're deploying

One Node.js process (`server/index.js`) serves everything:
- **CRM** — `index.html`, behind login, where staff manage funds/LPs/deals/etc.
- **LP portal** — `portal.html`, behind a separate per-company login.
- **Public marketing site** — `company.html`, `about.html`, `funds.html`,
  `team.html`, `contact.html` — no login required, meant for the public
  internet.
- **API** — everything under `/api/...`, used by all three of the above.

All of it comes from a single SQLite database file
(`server/data/crm.sqlite`) on local disk — no external database server to
provision.

## Prerequisites

- A Linux VPS (these steps assume Ubuntu/Debian; ask us for the CentOS/Alma
  equivalents if that's what you're running).
- Root or sudo SSH access to it.
- A domain name with its DNS A record already pointed at the VPS's public IP
  (needed for step 8; you can do everything up through step 6 without one).
- Node.js **≥ 22.5.0** — this app uses `node:sqlite`, which is only
  available from that version onward. Older Node will fail to start.

## 1. Connect and update the system

```bash
ssh user@your-server-ip
sudo apt update && sudo apt upgrade -y
```

## 2. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirm >= 22.5.0
```

## 3. Clone the repository

```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/omgany-cloud/VS-CRM.git crm
cd crm/server
sudo npm install --omit=dev
```

## 4. Configure `.env`

```bash
cp ../.env.example .env
nano .env
```

Set these before going live:

| Variable | What to set it to | Why |
|---|---|---|
| `JWT_SECRET` | Output of `openssl rand -hex 64` | Signs every login session. If left unset, the server auto-generates one and stores it in `server/data/.jwt_secret` — fine for a quick test, not for production (that file sits right next to the database it's meant to protect). |
| `PORTAL_DEMO_PASSWORD` | A real password of your choosing | Defaults to a shared demo password (`PortalDemo2025!`) used by every LP portal login. Change it before any real LP gets a portal link. |
| `TRUST_PROXY` | `1` | Required once nginx sits in front (step 7). Without it, every request looks like it comes from nginx's own IP, and the login rate-limiter locks out everyone after one person mistypes their password a few times. **Leave this unset if you ever run the app directly exposed to the internet with no reverse proxy** — setting it without a real proxy in front lets a visitor fake their own IP and dodge the rate limiter entirely. |
| `PORT` | `4000` (default, can leave blank) | Port the Node process listens on internally. nginx will proxy to this. |

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

## 6. Run it under pm2

pm2 keeps the process alive across crashes and server reboots.

```bash
sudo npm install -g pm2
pm2 start index.js --name crm
pm2 save
pm2 startup       # then run the one-line command it prints out
```

Useful pm2 commands for later:
```bash
pm2 status              # is it running?
pm2 logs crm            # tail live logs
pm2 restart crm         # after a deploy update (step 11)
```

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

## 10. Decide what lives at the bare domain

Right now, `https://your-domain.com/` (no path) serves `index.html` — the
CRM login screen. Two common options:

- **Keep it as-is**: staff bookmark `your-domain.com/index.html` (or you
  just get used to the CRM being what loads at the root), and the public
  site lives at `your-domain.com/company.html`, `/about.html`, etc.
- **Make the public site the homepage**: move the CRM to a path like
  `/app/` or a subdomain like `crm.your-domain.com`, and have
  `company.html`'s content serve at `/`. This is a small code change —
  ask us to make it if you want this instead of the default.

## 11. First login — do not reseed

Visit `https://your-domain.com/index.html`, log in with the real admin
account already in the database (`admin@turancapital.kz` + the current
password), or create additional real users from **Команда / Пользователи**
once logged in.

**Do not run `npm run seed`.** That script repopulates the database with
fictional demo data (fake LPs, deals, portfolio companies) — the kind that
was deliberately removed from this database already. It's only meant for
spinning up a fresh demo instance from scratch, not for a database that
already has real data in it.

## 12. Ongoing: deploying updates

Whenever new code is pushed to the `master` branch on GitHub:

```bash
cd /var/www/crm
sudo git pull origin master
cd server && sudo npm install --omit=dev   # only needed if package.json changed
pm2 restart crm
```

The live database (`server/data/crm.sqlite`) is untouched by a `git pull`
— it's gitignored and lives only on the server.

## 13. Backups

`server/backup.js` runs automatically inside the same process and writes
timestamped snapshots to `server/data/backups/` every 6 hours (30-day
retention). This is **still the same physical disk** as the live
database — a disk failure takes out the live DB and every local backup at
once. Once you have real off-machine storage (a cloud bucket, another
server, etc.), set up a cron job or similar to sync `server/data/backups/`
there too. Example (adjust the destination to whatever you use):
```bash
# crontab -e
0 * * * * rsync -a /var/www/crm/server/data/backups/ user@backup-host:/backups/crm/
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `curl http://localhost:4000/api/version` fails | Node process isn't running — check `pm2 status` / `pm2 logs crm`. |
| Login rate-limits everyone after one bad attempt | `TRUST_PROXY` isn't set in `.env` while nginx is in front — see step 4. |
| Public site pages (`company.html` etc.) show broken images | Team photos / PDFs are still on temporary `genspark.ai` hosting from initial site setup — ask us to swap in permanent files once you have them. |
| 502 from nginx | Node process crashed or isn't listening on port 4000 — check `pm2 logs crm` for the actual error. |
| Uploaded files / DB missing after a redeploy | Confirm `server/data/` wasn't accidentally deleted — it's gitignored on purpose (it holds real data, not code) but must persist across deploys. |
