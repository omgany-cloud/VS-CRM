# X feed analyzer

Standalone CLI that logs into your own X (Twitter) account and analyzes your
home timeline (top accounts, hashtags, keywords, engagement, rough
sentiment). Unrelated to the CRM app in this repo — a self-contained tool
under `tools/`.

## Requirements

- Node.js 18+ (uses the built-in `fetch`).
- An X developer app with **OAuth 2.0** enabled, on an API access tier that
  includes the home timeline endpoint (`GET /2/users/:id/timelines/reverse_chronological`).
  As of this writing that means **Basic tier or higher** — the Free tier
  does not expose this endpoint at all, no matter which scopes you grant.

## Setup

1. Create an app at https://developer.x.com/en/portal/projects-and-apps.
2. Under "User authentication settings", enable OAuth 2.0 and add a callback
   URL: `http://127.0.0.1:8787/callback` (or your own, matching `.env`).
3. Copy the Client ID (and Client Secret, if your app is a confidential
   client) into `.env`:
   ```
   cp .env.example .env
   # then edit .env
   ```
4. Run the one-time login flow. It opens a URL for you to approve in a
   browser, then captures the OAuth redirect on a local server:
   ```
   npm run auth
   ```
   This writes `tokens.json` (gitignored) with your access/refresh tokens.
5. Fetch and analyze your timeline:
   ```
   npm run analyze
   ```
   Prints a report to the console and also writes it to `report.json`.

## Notes

- Sentiment is a small keyword-based heuristic (see `src/analyze.js`), not a
  real NLP model — treat it as a rough signal, not ground truth.
- `MAX_PAGES` in `.env` caps how many 100-tweet pages are pulled per run to
  stay within X's rate limits.
- `tokens.json` and `report.json` contain your access token / feed content —
  both are gitignored; don't commit them.
