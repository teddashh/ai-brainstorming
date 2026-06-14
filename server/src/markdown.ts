import type { IdeaMessageRow, IdeaSessionRow } from './db.js';
import type { Participant } from './models.js';
import { participantName } from './models.js';

export function buildMarkdown(session: IdeaSessionRow, messages: IdeaMessageRow[]): string {
  const lines = [
    `# Idea Review: ${session.title || titleFromIdea(session.idea)}`,
    '',
    `- Email: ${session.email}`,
    `- Rounds: ${session.round_count}`,
    `- Created: ${new Date(session.created_at * 1000).toISOString()}`,
    '',
    '## Original Idea',
    '',
    session.idea.trim(),
    '',
    '## Review Transcript',
    '',
  ];
  for (const msg of messages.filter((m) => m.role === 'ai')) {
    lines.push(`### Round ${msg.round ?? '-'} - ${participantName((msg.provider || 'unknown') as Participant)}`);
    lines.push('', msg.content.trim(), '');
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
}

export function titleFromIdea(idea: string): string {
  const clean = idea.replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 72)}...` : clean;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function markdownToEmailHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level} style="margin:18px 0 8px;color:#14213d;">${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul style="margin:8px 0 12px 22px;padding:0;">');
        inList = true;
      }
      out.push(`<li style="margin:4px 0;">${escapeHtml(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p style="margin:8px 0;line-height:1.65;">${escapeHtml(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

