# Deployment checklist

This app currently runs locally (`node server/index.js`), no domain or
server yet. This is what to do, in order, when that changes.

## 1. Set a real JWT_SECRET
Copy `.env.example` to `.env` and set `JWT_SECRET` to a long random value
(e.g. `openssl rand -hex 64`), ideally sourced from a real secret manager
rather than living in a file on the same disk as the database it protects.
If you skip this, the server auto-generates and persists one at
`server/data/.jwt_secret` on first run — fine for local use, not for a
real deployment (that file lives next to the database itself).

## 2. Change the portal demo password
Set `PORTAL_DEMO_PASSWORD` in `.env` to something real before any LP
gets a portal link. It defaults to `PortalDemo2025!`, shared by every
portal company — fine for a demo, not for real LPs with real documents.

## 3. Get a domain + TLS certificate
Once you have a domain pointed at the server, get a certificate (e.g.
[Let's Encrypt](https://letsencrypt.org/) via certbot — free, auto-renewing).
Set `TLS_CERT_PATH`/`TLS_KEY_PATH` in `.env` to the cert/key file paths.
The server automatically switches from HTTP to HTTPS once both are set —
no code changes needed. Alternatively, terminate TLS at a reverse proxy
(nginx/Caddy) in front of the plain-HTTP server; either approach works.

## 4. Back up the backups
`server/backup.js` already writes timestamped snapshots to
`server/data/backups/` every 6 hours (30-day retention) — but that's
still the same physical disk as the live database. Once you have real
off-machine storage (cloud bucket, network share, etc.), sync
`server/data/backups/` there too — a disk failure currently takes out
the live DB and every local backup at once.

## 5. Reconfirm rate limiting is appropriate
`server/index.js`'s `authRateLimit` (10 attempts / 15 min / IP) covers
login and password-change. If you deploy behind a proxy/load balancer,
confirm `req.ip` still reflects the real client IP (may need
`app.set('trust proxy', ...)` — not currently set, since there's no
proxy yet) or the limiter will key off the proxy's IP for everyone.
