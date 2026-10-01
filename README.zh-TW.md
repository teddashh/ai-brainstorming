# AI Brainstorming

[English](README.md) · **繁體中文**

放在 `/idea` 的獨立網頁 MVP：由多個模型組成的點子審查小組。

**專案介紹頁：** https://teddashh.github.io/ai-brainstorming/?lang=zh-TW

使用者留下 email 和點子，選擇 5 / 12 / 16 輪，先拿到接續連結，跑完再拿到 Markdown 格式的審查紀錄：可以直接在頁面上看、下載，有設定 SMTP 時也會寄到信箱。

## 審查怎麼進行

1. `POST /api/idea/start` 把 session 存進 SQLite，回傳一組隨機 token。頁面網址會變成接續連結（`/idea?s=<token>`），有設定 SMTP 時也會把這個連結寄出。
2. 頁面隨即開始執行（`POST /api/idea/run/<token>`），進度以 server-sent events 串流回來。
3. 有設定 `SEARXNG_URL` 時，會用三組查詢（點子本身、市場風險、競品）整理出最多 9 筆結果的搜尋資料包。沒有設定時，prompt 會要求每個席位把所有說法都當成假設。
4. 每一輪由五個席位同時作答：Claude、Gemini、Grok、ChatGPT、DeepSeek。每則回答用繁體中文寫 350 到 650 字，並以最近 10 則回答作為上下文。
5. 跑完的紀錄會存起來、顯示在頁面上、可下載成 `idea-review.md`，並以附上 `.md` 檔的信件寄出。

| 輪數 | 立論 | 攻防 | 收斂 |
|---|---|---|---|
| 5 | 1 | 3 | 1 |
| 12 | 2 | 8 | 2 |
| 16 | 3 | 10 | 3 |

某個席位的模型呼叫失敗時，該輪會記下 `這一席暫時失敗：<原因>`，整場照常進行。逾時或其他錯誤會讓 session 標為失敗，頁面會出現重新執行的按鈕，重跑時從第 1 輪開始。

## 功能

- 公開的 `/idea` 介面，使用自己的中性主題（文字為繁體中文）
- 以 token 接續 session，不需要使用者帳號
- 以 WAL 模式的 SQLite 保存資料
- Claude / Gemini / Grok / ChatGPT / DeepSeek 各席位透過 OpenRouter 的 chat completions API 呼叫模型，每個席位都能替換模型
- 可選的 SearXNG 搜尋資料包
- 可選的 SMTP 寄信，內含轉成 HTML 的結果與 `.md` 附件
- Markdown 匯出 API
- 放在記憶體裡的基本頻率限制，保護公開的 MVP

## 安裝

需要 Node.js 20.19+ 或 22.12+（Vite 8 的最低需求），以及一組 OpenRouter API key。目前請用 Node 22：2026 年 9 月測試時，在 Node 24.21 上，lockfile 鎖定的 `better-sqlite3` 11.10.0 約有一半的啟動會中止（`Statement::~Statement` 裡的 `Assertion failed`），Node 22.23 則每次都正常啟動。`better-sqlite3` 從 12 版起才在 engines 列出 Node 24。

```bash
npm run install:all
npm run build
cp .env.example server/.env
```

編輯 `server/.env`，再啟動伺服器：

```bash
npm start
```

打開 http://localhost:3001/idea 。

`npm start` 會在 `server/` 裡執行 `node dist/index.js`，所以 `dotenv` 讀的是 `server/.env`，預設的 `DB_PATH`（`./data/ai-brainstorming.db`）也會建立 `server/data/`。如果改在 repo 根目錄執行 `node server/dist/index.js`，用的就是根目錄的 `.env` 和 `./data/`。

開發時，`npm run dev:server` 會用 `tsx watch` 執行伺服器。`npm run dev:web` 會啟動 Vite 開發伺服器，但 `web/vite.config.ts` 沒有設定 `/api` proxy，所以完整流程要由伺服器提供建置好的網頁。

正式部署時，先建置 `web/` 與 `server/`；`web/dist` 存在時伺服器會直接提供它（可用 `WEB_DIST_DIR` 改路徑），預設監聽 `127.0.0.1:3001`。請放在反向代理後面，並把 `PUBLIC_URL` 設成對外網址，因為信件裡的接續連結是用它組出來的。如果你的反向代理會覆寫 `X-Forwarded-For` / `X-Real-IP`，請設定 `TRUST_PROXY_HEADERS=true`，讓每 IP 的頻率限制看到真正的來源 IP。開啟後，伺服器會依序讀取 `CF-Connecting-IP`、`X-Real-IP`，最後是 `X-Forwarded-For` 的最後一筆。

## 環境變數

repo 裡沒有任何機密。執行資料放在 `data/`（用 `npm start` 啟動時位於 `server/` 底下），這個目錄不會進 git。

最少需要的設定：

- `OPENROUTER_API_KEY`
- `PUBLIC_URL`
- 部署在可信任的反向代理後面時，設定 `TRUST_PROXY_HEADERS=true`
- 要寄信的話，再加上 SMTP 相關變數

| 變數 | 預設值 | 用途 |
|---|---|---|
| `HOST`、`PORT` | `127.0.0.1`、`3001` | 監聽位址 |
| `PUBLIC_URL` | `http://localhost:3001` | 組接續連結用的對外網址 |
| `DB_PATH` | `./data/ai-brainstorming.db` | SQLite 檔案，相對於執行時的工作目錄 |
| `TRUST_PROXY_HEADERS` | `false` | 從反向代理的標頭取得來源 IP |
| `START_GLOBAL_LIMIT`、`RUN_GLOBAL_LIMIT` | `1000`、`200` | 全站每小時可建立與執行的次數 |
| `MAX_CONCURRENT_IDEA_RUNS` | `3` | 同時執行的上限，超過時回傳 `503 server_busy` |
| `RUN_TIMEOUT_MS` | `1800000`（30 分鐘） | 每次執行的時間上限 |
| `WEB_DIST_DIR` | `web/dist` | 要提供的網頁建置目錄 |
| `OPENROUTER_API_KEY` | 無 | 呼叫模型必填 |
| `OPENROUTER_SITE_URL`、`OPENROUTER_APP_NAME` | `PUBLIC_URL`、`AI Brainstorming` | 以 `HTTP-Referer` 與 `X-Title` 送給 OpenRouter |
| `MODEL_CLAUDE`、`MODEL_GEMINI`、`MODEL_GROK`、`MODEL_CHATGPT`、`MODEL_DEEPSEEK` | `anthropic/claude-sonnet-4`、`google/gemini-2.5-pro`、`x-ai/grok-4`、`openai/gpt-4o`、`deepseek/deepseek-r1` | 各席位的模型 ID |
| `SEARXNG_URL` | 空白 | 可選的搜尋來源 |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`、`SMTP_FROM_NAME` | port `465`、secure `true` | 可選的寄信設定；host、user、password 三者都有才會寄信 |

`MAX_CONCURRENT_IDEA_RUNS`、`RUN_TIMEOUT_MS`、`WEB_DIST_DIR` 伺服器會讀取，但沒有列在 `.env.example` 裡。

## 頻率限制

所有限制都放在記憶體裡，以一小時為一個區間，超過時回傳 `429` 並附上 `Retry-After`：

- 建立：每個 IP 12 次、每個 email 4 次，全站上限為 `START_GLOBAL_LIMIT`
- 執行：每個 IP 8 次，全站上限為 `RUN_GLOBAL_LIMIT`
- 已經在執行或已完成的 session 會回傳 `409`

## API

| 方法與路徑 | 用途 |
|---|---|
| `GET /api/health` | 健康檢查 |
| `POST /api/idea/start` | 用 `email`、`idea`（10 到 12,000 字）與 `roundCount`（5、12 或 16）建立 session |
| `GET /api/idea/session/:token` | 讀取 session 與其中的訊息 |
| `POST /api/idea/run/:token` | 執行審查，以 server-sent events 串流進度 |
| `GET /api/idea/export/:token.md` | 下載紀錄，檔名為 `idea-review.md` |

## 已知限制

- 拿到接續連結的人都能讀取該 session，包含 email。目前沒有刪除用的 API。
- 重啟伺服器會清掉頻率限制的計數。執行到一半被重啟的 session 會一直停在執行中，頁面也不會出現重新執行的按鈕。
- OpenRouter 的端點直接寫在 `server/src/llm.ts`，不是可以調整的設定。
- 為了讓回答不離題，模型輸出中提到「workflow」、「system prompt」、「SearXNG」、「提示詞」或「系統提示」的段落會被刪掉。點子本身和 workflow 有關時，也可能誤刪正常內容。
- 搭配 lockfile 鎖定的 `better-sqlite3` 11.10.0，Node 24 並不穩定（見「安裝」）。
- 目前還沒有測試與 CI。

## 相關專案

- [claude-idea-review-skill](https://teddashh.github.io/claude-idea-review-skill/?lang=zh-TW)：在 Claude Code 裡跑類似的 5 / 12 / 16 輪點子審查。

## 授權

這個 repo 目前還沒有加入授權檔。
