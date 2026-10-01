import 'dotenv/config';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ideaStmts, type IdeaMessageRow, type IdeaSessionRow } from './db.js';
import { buildMarkdown, titleFromIdea } from './markdown.js';
import { sendResumeEmail, sendResultEmail } from './mail.js';
import { buildPrompt, callParticipant, type StepResult } from './llm.js';
import { buildResearchBundle } from './research.js';
import { normalizeRoundCount, participants, schedule, type Participant } from './models.js';

const app = new Hono();
const running = new Set<string>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '');
const TRUST_PROXY_HEADERS = (process.env.TRUST_PROXY_HEADERS || 'false').toLowerCase() === 'true';
const START_GLOBAL_LIMIT = Number(process.env.START_GLOBAL_LIMIT || 1000);
const RUN_GLOBAL_LIMIT = Number(process.env.RUN_GLOBAL_LIMIT || 200);
let lastPrune = 0;

function clientIp(c: Context): string {
  if (TRUST_PROXY_HEADERS) {
    const xForwardedFor = c.req.header('x-forwarded-for')
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .pop();
    return c.req.header('cf-connecting-ip')?.trim()
      || c.req.header('x-real-ip')?.trim()
      || xForwardedFor
      || getConnInfo(c).remote.address
      || 'unknown';
  }
  return getConnInfo(c).remote.address || 'unknown';
}

function rateLimit(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  if (now - lastPrune > 5 * 60 * 1000) {
    lastPrune = now;
    for (const [bucketKey, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (bucket.count >= limit) return Math.ceil((bucket.resetAt - now) / 1000);
  bucket.count += 1;
  return null;
}

function tooMany(c: Context, retryAfter: number) {
  return c.json({ error: 'rate_limited', retryAfter }, 429, { 'Retry-After': String(retryAfter) });
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

function cleanIdea(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const idea = value.trim();
  return idea.length >= 10 && idea.length <= 12000 ? idea : null;
}

function isRoundCountInput(value: unknown): boolean {
  return value === undefined || value === 5 || value === 12 || value === 16 || value === '5' || value === '12' || value === '16';
}

function serializeSession(row: IdeaSessionRow, messages: IdeaMessageRow[]) {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    idea: row.idea,
    roundCount: row.round_count,
    status: row.status,
    title: row.title,
    markdown: row.markdown,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      provider: m.provider,
      round: m.round,
      label: m.label,
      content: m.content,
      timestamp: m.timestamp,
    })),
  };
}

function emit(stream: Parameters<Parameters<typeof streamSSE>[1]>[0], event: Record<string, unknown>): Promise<void> {
  try {
    return stream.writeSSE({ event: String(event.type || 'message'), data: JSON.stringify(event) }).catch(() => {});
  } catch {
    // Best-effort live stream. DB/email are source of truth.
    return Promise.resolve();
  }
}

function resumeUrl(token: string) {
  return `${PUBLIC_URL}/idea?s=${encodeURIComponent(token)}`;
}

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/idea/start', async (c) => {
  const ipRetry = rateLimit(`start:ip:${clientIp(c)}`, 12, 60 * 60 * 1000);
  if (ipRetry !== null) return tooMany(c, ipRetry);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const email = cleanEmail(body.email);
  const idea = cleanIdea(body.idea);
  const rawRounds = body.roundCount ?? body.round_count;
  if (!isRoundCountInput(rawRounds)) {
    return c.json({ error: 'invalid_round_count' }, 400);
  }
  const roundCount = normalizeRoundCount(rawRounds);
  if (!email || !idea) return c.json({ error: 'invalid_input' }, 400);
  const emailRetry = rateLimit(`start:email:${email}`, 4, 60 * 60 * 1000);
  if (emailRetry !== null) return tooMany(c, emailRetry);
  const globalRetry = rateLimit('start:global', START_GLOBAL_LIMIT, 60 * 60 * 1000);
  if (globalRetry !== null) return tooMany(c, globalRetry);

  const id = randomUUID();
  const token = randomBytes(24).toString('base64url');
  const title = titleFromIdea(idea);
  ideaStmts.insertSession.run(id, email, token, idea, roundCount, title);
  ideaStmts.insertMessage.run(id, 'user', null, null, 'Original idea', idea, Math.floor(Date.now() / 1000));
  const emailSent = await sendResumeEmail({ to: email, title, resumeUrl: resumeUrl(token) }).catch(() => false);
  const row = ideaStmts.findByToken.get(token) as IdeaSessionRow;
  const messages = ideaStmts.listMessages.all(id) as IdeaMessageRow[];
  return c.json({ session: serializeSession(row, messages), emailSent });
});

app.get('/api/idea/session/:token', (c) => {
  const row = ideaStmts.findByToken.get(c.req.param('token')) as IdeaSessionRow | undefined;
  if (!row) return c.json({ error: 'not_found' }, 404);
  const messages = ideaStmts.listMessages.all(row.id) as IdeaMessageRow[];
  return c.json({ session: serializeSession(row, messages) });
});

app.get('/api/idea/export/:file', (c) => {
  const token = c.req.param('file').replace(/\.md$/i, '');
  const row = ideaStmts.findByToken.get(token) as IdeaSessionRow | undefined;
  if (!row) return c.text('Not Found', 404);
  const messages = ideaStmts.listMessages.all(row.id) as IdeaMessageRow[];
  const markdown = row.markdown || buildMarkdown(row, messages);
  return c.body(markdown, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': 'attachment; filename="idea-review.md"',
  });
});

app.post('/api/idea/run/:token', (c) => {
  const ipRetry = rateLimit(`run:ip:${clientIp(c)}`, 8, 60 * 60 * 1000);
  if (ipRetry !== null) return tooMany(c, ipRetry);
  const token = c.req.param('token');
  const row = ideaStmts.findByToken.get(token) as IdeaSessionRow | undefined;
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'completed') return c.json({ error: 'already_completed' }, 409);
  if (running.has(row.id)) return c.json({ error: 'already_running' }, 409);
  if (running.size >= Number(process.env.MAX_CONCURRENT_IDEA_RUNS || 3)) {
    return c.json({ error: 'server_busy' }, 503);
  }
  const globalRetry = rateLimit('run:global', RUN_GLOBAL_LIMIT, 60 * 60 * 1000);
  if (globalRetry !== null) return tooMany(c, globalRetry);

  running.add(row.id);
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.RUN_TIMEOUT_MS || 30 * 60 * 1000));
    const ping = setInterval(() => emit(stream, { type: 'idea_ping' }), 15000);
    let finalEvents: Promise<unknown> = Promise.resolve();
    try {
      ideaStmts.markRunning.run(row.id);
      ideaStmts.deleteAiMessages.run(row.id);
      emit(stream, { type: 'workflow', status: '建立搜尋資料包中...' });
      const evidence = await buildResearchBundle(row.idea, controller.signal);
      const phases = schedule(normalizeRoundCount(row.round_count));
      const history: StepResult[] = [];
      for (let round = 1; round <= phases.length; round++) {
        if (controller.signal.aborted) throw new Error('idea run timed out');
        const phase = phases[round - 1];
        emit(stream, { type: 'idea_progress', round, totalRounds: phases.length, completed: 0, total: participants.length, status: `第 ${round} 輪開始` });
        for (const provider of participants) {
          emit(stream, { type: 'role', provider, role: `R${round}`, label: `第 ${round} 輪` });
        }
        const roundHistory = [...history];
        const tasks = participants.map(async (provider, index) => {
          try {
            const prompt = buildPrompt({ idea: row.idea, participant: provider, round, totalRounds: phases.length, phase, evidence, history: roundHistory });
            const text = await callParticipant(provider, prompt, controller.signal);
            return { index, provider, text };
          } catch (err) {
            return { index, provider, text: `這一席暫時失敗：${(err as Error).message}` };
          }
        });
        const pending = new Map<number, (typeof tasks)[number]>();
        tasks.forEach((task, index) => pending.set(index, task));
        const results: Array<Awaited<(typeof tasks)[number]> | undefined> = Array(tasks.length);
        while (pending.size > 0) {
          const result = await Promise.race(pending.values());
          if (controller.signal.aborted) throw new Error('idea run timed out');
          pending.delete(result.index);
          results[result.index] = result;
          emit(stream, { type: 'done', provider: result.provider, text: result.text });
          emit(stream, { type: 'idea_progress', round, totalRounds: phases.length, completed: results.filter(Boolean).length, total: participants.length, status: `第 ${round} 輪進行中` });
        }
        for (const result of results) {
          if (!result) continue;
          const inserted = ideaStmts.insertMessage.run(row.id, 'ai', result.provider, round, `第 ${round} 輪`, result.text, Math.floor(Date.now() / 1000));
          emit(stream, {
            type: 'idea_message',
            message: {
              id: Number(inserted.lastInsertRowid),
              role: 'ai',
              provider: result.provider,
              round,
              label: `第 ${round} 輪`,
              content: result.text,
              timestamp: Math.floor(Date.now() / 1000),
            },
          });
          history.push({ provider: result.provider as Participant, round, text: result.text });
        }
      }
      if (controller.signal.aborted) throw new Error('idea run timed out');
      const fresh = ideaStmts.findByToken.get(token) as IdeaSessionRow;
      const messages = ideaStmts.listMessages.all(row.id) as IdeaMessageRow[];
      const markdown = buildMarkdown(fresh, messages);
      ideaStmts.markCompleted.run(markdown, row.id);
      const completed = ideaStmts.findByToken.get(token) as IdeaSessionRow;
      const finalMessages = ideaStmts.listMessages.all(row.id) as IdeaMessageRow[];
      await sendResultEmail({ to: completed.email, title: completed.title || titleFromIdea(completed.idea), resumeUrl: resumeUrl(token), markdown }).catch(() => false);
      finalEvents = Promise.all([
        emit(stream, { type: 'idea_completed', session: serializeSession(completed, finalMessages) }),
        emit(stream, { type: 'finish' }),
      ]);
    } catch (err) {
      ideaStmts.markFailed.run((err as Error).message.slice(0, 1000), row.id);
      finalEvents = Promise.all([
        emit(stream, { type: 'error', message: (err as Error).message }),
        emit(stream, { type: 'finish' }),
      ]);
    } finally {
      clearTimeout(timeout);
      clearInterval(ping);
      running.delete(row.id);
    }
    // streamSSE closes the stream as soon as this callback returns, and writeSSE
    // only writes after an internal await, so let the last events go out first.
    await finalEvents;
  });
});

const compiledDir = dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST_DIR || resolve(compiledDir, '../../web/dist');
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: webDist }));
  app.get('*', serveStatic({ root: webDist, path: 'index.html' }));
}

const port = Number(process.env.PORT || 3001);
const hostname = process.env.HOST || '127.0.0.1';
console.log(`AI Brainstorming listening on http://${hostname}:${port}`);
serve({ fetch: app.fetch, port, hostname });
