# AI Brainstorming

**English** · [繁體中文](README.zh-TW.md)

Standalone web MVP for a multi-model idea review panel at `/idea`.

**Project page:** https://teddashh.github.io/ai-brainstorming/

Users enter an email and an idea, choose 5 / 12 / 16 rounds, receive a resume link, and get the review transcript as Markdown: on the page, as a download, and by email when SMTP is configured.

## How a review runs

1. `POST /api/idea/start` stores the session in SQLite and returns a random token. The page URL becomes the resume link (`/idea?s=<token>`), which is also emailed when SMTP is configured.
2. The page starts the run right away (`POST /api/idea/run/<token>`), and progress streams back as server-sent events.
3. If `SEARXNG_URL` is set, three searches (the idea, its market risk, its competitors) build an evidence bundle of up to 9 results. Without it, the prompt tells every seat to treat claims as hypotheses.
4. Each round, five seats answer in parallel: Claude, Gemini, Grok, ChatGPT, and DeepSeek. Every answer is written in Traditional Chinese, 350 to 650 characters, with the last 10 answers as context.
5. The finished transcript is stored, shown on the page, downloadable as `idea-review.md`, and emailed with the `.md` file attached.

| Rounds | Thesis | Clash | Converge |
|---|---|---|---|
| 5 | 1 | 3 | 1 |
| 12 | 2 | 8 | 2 |
| 16 | 3 | 10 | 3 |

A seat whose model call fails records `這一席暫時失敗：<reason>` for that round, and the run continues. A timeout or other error marks the session as failed; the page then offers a retry, which starts again from round 1.

## Features

- Public `/idea` UI with its own neutral theme (the copy is Traditional Chinese)
- Token-based session resume, no user accounts
- SQLite persistence in WAL mode
- Model calls through OpenRouter's chat completions API for the Claude / Gemini / Grok / ChatGPT / DeepSeek seats, with a model override per seat
- Optional SearXNG evidence bundle
- Optional SMTP email with the rendered result and an `.md` attachment
- Markdown export endpoint
- Basic in-memory rate limits for public MVP protection

## Setup

Requires Node.js 20.19+ or 22.12+ (the minimum for Vite 8) and an OpenRouter API key. Use Node 22 for now: on Node 24.21, the locked `better-sqlite3` 11.10.0 aborted at startup (`Assertion failed` in `Statement::~Statement`) in about half of the test runs in September 2026, while Node 22.23 started cleanly every time. `better-sqlite3` 12 is the first release line that lists Node 24 in its engines.

```bash
npm run install:all
npm run build
cp .env.example server/.env
```

Edit `server/.env`, then run the server:

```bash
npm start
```

Open http://localhost:3001/idea.

`npm start` runs `node dist/index.js` inside `server/`, so `dotenv` reads `server/.env`, and the default `DB_PATH` (`./data/ai-brainstorming.db`) creates `server/data/`. If you run `node server/dist/index.js` from the repository root instead, a root `.env` and `./data/` are used.

For development, `npm run dev:server` runs the server with `tsx watch`. `npm run dev:web` starts the Vite dev server, but `web/vite.config.ts` has no `/api` proxy, so the full flow needs the built app served by the server.

For production, build `web/` and `server/`; the server serves `web/dist` when present (`WEB_DIST_DIR` overrides the path) and listens on `127.0.0.1:3001` by default. Put it behind a reverse proxy and set `PUBLIC_URL` to the public origin, because resume links in emails are built from it. If your proxy overwrites `X-Forwarded-For` / `X-Real-IP`, set `TRUST_PROXY_HEADERS=true` so per-IP rate limits use the real client IP. With it on, the server reads `CF-Connecting-IP`, then `X-Real-IP`, then the last `X-Forwarded-For` entry.

## Environment

No secrets are committed. Runtime data lives in `data/` (under `server/` when started with `npm start`), which is ignored by git.

Minimum useful config:

- `OPENROUTER_API_KEY`
- `PUBLIC_URL`
- `TRUST_PROXY_HEADERS=true` when deployed behind a trusted reverse proxy
- SMTP variables if you want emails delivered

| Variable | Default | Purpose |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `3001` | Listen address |
| `PUBLIC_URL` | `http://localhost:3001` | Origin used for resume links |
| `DB_PATH` | `./data/ai-brainstorming.db` | SQLite file, relative to the working directory |
| `TRUST_PROXY_HEADERS` | `false` | Take the client IP from proxy headers |
| `START_GLOBAL_LIMIT`, `RUN_GLOBAL_LIMIT` | `1000`, `200` | Site-wide starts and runs per hour |
| `MAX_CONCURRENT_IDEA_RUNS` | `3` | Runs at once; the next one gets `503 server_busy` |
| `RUN_TIMEOUT_MS` | `1800000` (30 minutes) | Time limit per run |
| `WEB_DIST_DIR` | `web/dist` | Built web app to serve |
| `OPENROUTER_API_KEY` | none | Required for model calls |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` | `PUBLIC_URL`, `AI Brainstorming` | Sent to OpenRouter as `HTTP-Referer` and `X-Title` |
| `MODEL_CLAUDE`, `MODEL_GEMINI`, `MODEL_GROK`, `MODEL_CHATGPT`, `MODEL_DEEPSEEK` | `anthropic/claude-sonnet-4`, `google/gemini-2.5-pro`, `x-ai/grok-4`, `openai/gpt-4o`, `deepseek/deepseek-r1` | Model ID for each seat |
| `SEARXNG_URL` | empty | Optional evidence search |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME` | port `465`, secure `true` | Optional email; skipped unless host, user, and password are all set |

`MAX_CONCURRENT_IDEA_RUNS`, `RUN_TIMEOUT_MS`, and `WEB_DIST_DIR` are read by the server but are not listed in `.env.example`.

## Rate limits

All limits are in memory, per one-hour window, and answer `429` with `Retry-After`:

- Start: 12 per IP, 4 per email, `START_GLOBAL_LIMIT` site-wide
- Run: 8 per IP, `RUN_GLOBAL_LIMIT` site-wide
- A session that is already running or completed returns `409`

## API

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `POST /api/idea/start` | Create a session from `email`, `idea` (10 to 12,000 characters), and `roundCount` (5, 12, or 16) |
| `GET /api/idea/session/:token` | Read a session and its messages |
| `POST /api/idea/run/:token` | Run the review and stream progress as server-sent events |
| `GET /api/idea/export/:token.md` | Download the transcript as `idea-review.md` |

## Known limits

- Anyone with a resume link can read that session, including its email address. There is no delete endpoint.
- A server restart clears the rate limit counters. A run interrupted by a restart stays marked as running, and the page shows no retry button for it.
- The OpenRouter endpoint is fixed in `server/src/llm.ts`; it is not a setting.
- To keep answers on topic, paragraphs that mention "workflow", "system prompt", "SearXNG", 提示詞, or 系統提示 are removed from model output. This can also remove real content when the idea itself is about workflows.
- Node 24 is not safe with the locked `better-sqlite3` 11.10.0 (see Setup).
- There are no tests or CI yet.

## Related

- [claude-idea-review-skill](https://teddashh.github.io/claude-idea-review-skill/) runs a similar 5 / 12 / 16-round idea review inside Claude Code.

## License

MIT, see [LICENSE](LICENSE).
