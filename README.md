# AI Brainstorming

Standalone MVP for multi-agent idea review at `/idea`.

Users enter an email and an idea, choose 5 / 12 / 16 rounds, receive a resume link, and get a rendered Markdown result by email when the review completes.

## Features

- Public `/idea` UI with its own neutral theme
- Token-based session resume, no user accounts
- SQLite persistence under `data/`
- OpenRouter-compatible model calls for Claude / Gemini / Grok / ChatGPT / DeepSeek seats
- Optional SearXNG evidence bundle
- Optional SMTP email with rendered result and `.md` attachment
- Markdown export endpoint
- Basic in-memory rate limits for public MVP protection

## Setup

```bash
cp .env.example .env
npm run install:all
npm run build
```

Run the server:

```bash
npm start
```

Run the Vite dev server separately:

```bash
cd web
npm run dev
```

For production, build `web/` and `server/`; the server serves `web/dist` when present.
Put it behind a reverse proxy and set `PUBLIC_URL` to the public origin. If your proxy overwrites `X-Forwarded-For` / `X-Real-IP`, set `TRUST_PROXY_HEADERS=true` so per-IP rate limits use the real client IP.

## Environment

No secrets are committed. Runtime data lives in `data/`, which is ignored by git.

Minimum useful config:

- `OPENROUTER_API_KEY`
- `PUBLIC_URL`
- `TRUST_PROXY_HEADERS=true` when deployed behind a trusted reverse proxy
- SMTP variables if you want emails delivered
