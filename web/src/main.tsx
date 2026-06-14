import React from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

type IdeaRoundCount = 5 | 12 | 16;
type IdeaStatus = 'created' | 'running' | 'completed' | 'failed';
type IdeaMessage = {
  id: number;
  role: 'user' | 'ai' | 'system';
  provider: string | null;
  round: number | null;
  label: string | null;
  content: string;
  timestamp: number;
};
type IdeaSession = {
  id: string;
  email: string;
  token: string;
  idea: string;
  roundCount: IdeaRoundCount;
  status: IdeaStatus;
  title: string | null;
  markdown: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  messages: IdeaMessage[];
};
type StreamEvent =
  | { type: 'workflow'; status: string }
  | { type: 'idea_progress'; round: number; totalRounds: number; completed: number; total: number; status: string }
  | { type: 'role'; provider: string; role: string; label: string }
  | { type: 'done'; provider: string; text: string }
  | { type: 'idea_message'; message: IdeaMessage }
  | { type: 'idea_completed'; session: IdeaSession }
  | { type: 'idea_ping' }
  | { type: 'error'; message: string; provider?: string }
  | { type: 'finish' };

const providers = ['claude', 'gemini', 'grok', 'chatgpt', 'deepseek'];
const providerName: Record<string, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  chatgpt: 'ChatGPT',
  deepseek: 'DeepSeek',
};

function tokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('s');
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function MarkdownBlock({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className={compact ? 'md-h1 compact' : 'md-h1'}>{children}</h1>,
        h2: ({ children }) => <h2 className={compact ? 'md-h2 compact' : 'md-h2'}>{children}</h2>,
        h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
        p: ({ children }) => <p className={compact ? 'md-p compact' : 'md-p'}>{children}</p>,
        strong: ({ children }) => <strong className="md-strong">{children}</strong>,
        ul: ({ children }) => <ul className="md-list">{children}</ul>,
        ol: ({ children }) => <ol className="md-list ordered">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="md-quote">{children}</blockquote>,
        code: ({ children }) => <code className="md-code">{children}</code>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function markdownFromSession(session: IdeaSession): string {
  if (session.markdown) return session.markdown;
  const lines = [`# Idea Review: ${session.title || 'Untitled'}`, '', '## Original Idea', '', session.idea, '', '## Review Transcript', ''];
  for (const msg of session.messages.filter((m) => m.role === 'ai')) {
    lines.push(`### Round ${msg.round ?? '-'} - ${providerName[msg.provider || ''] || msg.provider || 'AI'}`);
    lines.push('', msg.content, '');
  }
  return lines.join('\n');
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ReviewCard({ msg, defaultOpen }: { msg: IdeaMessage; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const who = providerName[msg.provider || ''] || msg.provider || 'AI';
  return (
    <article className="review-card">
      <button type="button" className="review-toggle" onClick={() => setOpen((v) => !v)}>
        <span>
          <span className="review-provider">{who}</span>
          <span className="review-time">{fmt(msg.timestamp)}</span>
        </span>
        <span className="chevron">{open ? '⌄' : '›'}</span>
      </button>
      {open && (
        <div className="review-body">
          <MarkdownBlock text={msg.content} compact />
          <button type="button" className="collapse-bottom" onClick={() => setOpen(false)}>收起 ⌃</button>
        </div>
      )}
    </article>
  );
}

function App() {
  const [email, setEmail] = React.useState('');
  const [idea, setIdea] = React.useState('');
  const [roundCount, setRoundCount] = React.useState<IdeaRoundCount>(5);
  const [session, setSession] = React.useState<IdeaSession | null>(null);
  const [token, setToken] = React.useState<string | null>(() => tokenFromUrl());
  const [messages, setMessages] = React.useState<IdeaMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [workflow, setWorkflow] = React.useState('');
  const [progress, setProgress] = React.useState<{ round: number; totalRounds: number; completed: number; total: number } | null>(null);
  const [seatStatus, setSeatStatus] = React.useState<Record<string, 'idle' | 'working' | 'done' | 'error'>>({});
  const [error, setError] = React.useState<string | null>(null);
  const autoRun = React.useRef<string | null>(null);

  React.useEffect(() => {
    const t = tokenFromUrl();
    if (!t) return;
    setBusy(true);
    fetch(`/api/idea/session/${encodeURIComponent(t)}`)
      .then((r) => readJson<{ session: IdeaSession }>(r))
      .then((data) => {
        setToken(data.session.token);
        setSession(data.session);
        setMessages(data.session.messages);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }, []);

  async function startSession(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/idea/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, idea, roundCount }),
      });
      const data = await readJson<{ session: IdeaSession; emailSent: boolean }>(res);
      setSession(data.session);
      setToken(data.session.token);
      setMessages(data.session.messages);
      window.history.replaceState({}, '', `/idea?s=${encodeURIComponent(data.session.token)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runSession() {
    if (!token) return;
    setRunning(true);
    setWorkflow('啟動中...');
    setProgress(null);
    setSeatStatus({});
    setMessages((prev) => prev.filter((m) => m.role !== 'ai'));
    try {
      const res = await fetch(`/api/idea/run/${encodeURIComponent(token)}`, { method: 'POST' });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const line = block.split('\n').find((x) => x.startsWith('data:'));
          if (!line) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(5).trim()) as StreamEvent;
          } catch {
            continue;
          }
          if (event.type === 'workflow') setWorkflow(event.status);
          if (event.type === 'idea_progress') {
            setWorkflow(event.status);
            setProgress({ round: event.round, totalRounds: event.totalRounds, completed: event.completed, total: event.total });
            if (event.completed === 0) setSeatStatus(Object.fromEntries(providers.map((p) => [p, 'idle'])));
          }
          if (event.type === 'role') setSeatStatus((prev) => ({ ...prev, [event.provider]: 'working' }));
          if (event.type === 'done') setSeatStatus((prev) => ({ ...prev, [event.provider]: 'done' }));
          if (event.type === 'idea_message') {
            setMessages((prev) => prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message].sort((a, b) => a.id - b.id));
          }
          if (event.type === 'idea_completed') {
            setSession(event.session);
            setMessages(event.session.messages);
            setWorkflow('完成，結果信已送出。');
          }
          if (event.type === 'error') {
            setError(event.message);
            setWorkflow('執行失敗，可以重新執行。');
            setSession((prev) => prev ? { ...prev, status: 'failed', error: event.message } : prev);
            if (event.provider) setSeatStatus((prev) => ({ ...prev, [event.provider as string]: 'error' }));
          }
          if (event.type === 'finish') setRunning(false);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  React.useEffect(() => {
    if (!session || !token || running || session.status !== 'created') return;
    if (autoRun.current === session.id) return;
    autoRun.current = session.id;
    void runSession();
  }, [session, token, running]);

  React.useEffect(() => {
    if (!session || !token || session.status !== 'running' || running) return;
    setWorkflow('背景 review 仍在進行，正在同步最新狀態...');
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/idea/session/${encodeURIComponent(token)}`);
        if (!res.ok) return;
        const data = await res.json();
        setSession(data.session);
        setMessages(data.session.messages || []);
        if (data.session.status === 'completed') setWorkflow('完成，結果已可下載。');
        if (data.session.status === 'failed') setWorkflow('執行失敗，可以重新執行。');
      } catch {
        // Keep polling; the server or network may recover.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [session, token, running]);

  const aiMessages = messages.filter((m) => m.role === 'ai');
  const grouped = React.useMemo(() => {
    const map = new Map<number, IdeaMessage[]>();
    for (const msg of aiMessages) {
      const round = msg.round ?? 0;
      map.set(round, [...(map.get(round) ?? []), msg]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [aiMessages]);
  const markdown = session ? markdownFromSession(session) : '';

  return (
    <main className="app">
      <header className="top">
        <div>
          <div className="eyebrow">AI Brainstorming</div>
          <h1>團隊式 idea review</h1>
        </div>
        <a className="new-link" href="/idea">New</a>
      </header>

      {!session ? (
        <form className="start-grid" onSubmit={startSession}>
          <aside className="panel">
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
            <div className="rounds">
              <span>輪數</span>
              {[5, 12, 16].map((n) => (
                <button key={n} type="button" className={roundCount === n ? 'selected' : ''} onClick={() => setRoundCount(n as IdeaRoundCount)}>{n}</button>
              ))}
            </div>
            {error && <div className="error">{error}</div>}
          </aside>
          <section className="idea-entry">
            <label>Idea<textarea required value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="貼上你的產品、功能、商業模式或決策題..." /></label>
            <button className="primary" disabled={busy || !email.includes('@') || idea.trim().length < 10}>{busy ? '建立中...' : '送出並開始 review'}</button>
          </section>
        </form>
      ) : (
        <div className="session-grid">
          <aside className="side">
            <section className="panel">
              <div className="eyebrow">Session</div>
              <h2>{session.title || 'Untitled idea'}</h2>
              <dl>
                <div><dt>Email</dt><dd>{session.email}</dd></div>
                <div><dt>Rounds</dt><dd>{session.roundCount}</dd></div>
                <div><dt>Status</dt><dd>{session.status}</dd></div>
              </dl>
            </section>
            <section className="panel">
              <h3>Progress</h3>
              <p>{workflow || (session.status === 'created' ? '準備開始...' : '等待狀態')}</p>
              {progress && <div className="bar"><span style={{ width: `${Math.max(4, progress.completed / Math.max(progress.total, 1) * 100)}%` }} /></div>}
              {session.status === 'failed' && <button className="primary small" onClick={runSession} disabled={running}>重新執行</button>}
              {session.status === 'completed' && <a className="download-side" href={`/api/idea/export/${encodeURIComponent(session.token)}.md`}>下載 Markdown</a>}
            </section>
          </aside>
          <section className="main-panel">
            {session.status === 'completed' ? (
              <article className="result">
                <div className="export-box">
                  <div><div className="eyebrow">Export</div><b>完整 Markdown 結果</b></div>
                  <a className="primary link" href={`/api/idea/export/${encodeURIComponent(session.token)}.md`}>下載 Markdown</a>
                </div>
                <MarkdownBlock text={markdown} />
              </article>
            ) : (
              <div className="timeline">
                <details className="idea-original" open><summary>查看原始 idea</summary><p>{session.idea}</p></details>
                {progress && (
                  <section className="current-round">
                    <div><span className="eyebrow">Current round</span><h2>第 {progress.round} / {progress.totalRounds} 輪</h2></div>
                    <b>{progress.completed} / {progress.total}</b>
                    <div className="seats">
                      {providers.map((p) => <span key={p} className={seatStatus[p] || 'idle'}>{providerName[p]}<small>{seatStatus[p] || 'waiting'}</small></span>)}
                    </div>
                  </section>
                )}
                <section className="round-timeline">
                  <div className="timeline-head"><span className="eyebrow">Round timeline</span><small>{aiMessages.length} responses</small></div>
                  {grouped.length === 0 ? <div className="empty">Review 會自動開始；每位成員完成時會按輪次出現在這裡。</div> : grouped.map(([round, rows]) => (
                    <section key={round} className="round-group">
                      <header><b>第 {round} 輪</b><small>{rows.length} / {progress?.total || providers.length}</small></header>
                      <div className="cards">
                        {rows.slice().sort((a, b) => providers.indexOf(a.provider || '') - providers.indexOf(b.provider || '')).map((msg) => (
                          <ReviewCard key={msg.id} msg={msg} defaultOpen={round === progress?.round} />
                        ))}
                      </div>
                    </section>
                  ))}
                </section>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
