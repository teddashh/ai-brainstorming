import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = resolve(process.env.DB_PATH || './data/ai-brainstorming.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS idea_sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    idea TEXT NOT NULL,
    round_count INTEGER NOT NULL CHECK (round_count IN (5,12,16)),
    status TEXT NOT NULL CHECK (status IN ('created','running','completed','failed')),
    title TEXT,
    markdown TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    started_at INTEGER,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_idea_sessions_token ON idea_sessions(token);
  CREATE INDEX IF NOT EXISTS idx_idea_sessions_email ON idea_sessions(email, updated_at DESC);

  CREATE TABLE IF NOT EXISTS idea_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES idea_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','ai','system')),
    provider TEXT,
    round INTEGER,
    label TEXT,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_idea_messages_session ON idea_messages(session_id, id);
`);

export interface IdeaSessionRow {
  id: string;
  email: string;
  token: string;
  idea: string;
  round_count: number;
  status: 'created' | 'running' | 'completed' | 'failed';
  title: string | null;
  markdown: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface IdeaMessageRow {
  id: number;
  session_id: string;
  role: 'user' | 'ai' | 'system';
  provider: string | null;
  round: number | null;
  label: string | null;
  content: string;
  timestamp: number;
}

export const ideaStmts = {
  insertSession: db.prepare<[string, string, string, string, number, string]>(
    `INSERT INTO idea_sessions (id, email, token, idea, round_count, title, status)
     VALUES (?, ?, ?, ?, ?, ?, 'created')`,
  ),
  findByToken: db.prepare<[string]>(`SELECT * FROM idea_sessions WHERE token = ?`),
  markRunning: db.prepare<[string]>(
    `UPDATE idea_sessions
       SET status='running',
           started_at=COALESCE(started_at, strftime('%s','now')),
           updated_at=strftime('%s','now'),
           error=NULL
     WHERE id=?`,
  ),
  markCompleted: db.prepare<[string, string]>(
    `UPDATE idea_sessions
       SET status='completed',
           markdown=?,
           completed_at=strftime('%s','now'),
           updated_at=strftime('%s','now'),
           error=NULL
     WHERE id=?`,
  ),
  markFailed: db.prepare<[string, string]>(
    `UPDATE idea_sessions SET status='failed', error=?, updated_at=strftime('%s','now') WHERE id=?`,
  ),
  insertMessage: db.prepare<
    [string, 'user' | 'ai' | 'system', string | null, number | null, string | null, string, number]
  >(
    `INSERT INTO idea_messages (session_id, role, provider, round, label, content, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  listMessages: db.prepare<[string]>(`SELECT * FROM idea_messages WHERE session_id = ? ORDER BY id`),
  deleteAiMessages: db.prepare<[string]>(`DELETE FROM idea_messages WHERE session_id = ? AND role = 'ai'`),
};

