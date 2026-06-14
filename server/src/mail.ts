import nodemailer, { type Transporter } from 'nodemailer';
import { escapeHtml, markdownToEmailHtml } from './markdown.js';

let cached: Transporter | null = null;

function transport(): Transporter | null {
  if (cached) return cached;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  cached = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
    auth: { user, pass: pass.replace(/\s+/g, '') },
  });
  return cached;
}

function from() {
  return {
    name: process.env.SMTP_FROM_NAME || 'AI Brainstorming',
    address: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com',
  };
}

export async function sendResumeEmail(p: {
  to: string;
  title: string;
  resumeUrl: string;
}): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;
  const safeTitle = escapeHtml(p.title).slice(0, 140) || '你的 idea session';
  await tx.sendMail({
    from: from(),
    to: p.to,
    subject: `你的 AI Brainstorming session：${p.title.slice(0, 80)}`,
    text: `你的 AI Brainstorming session:\n${p.title}\n\n${p.resumeUrl}`,
    html: `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18212f;background:#fbfaf7;">
      <h2 style="margin:0 0 10px;color:#14213d;">AI Brainstorming session</h2>
      <p>這是你的專屬 idea review session 連結：</p>
      <p style="font-weight:700;">${safeTitle}</p>
      <p><a href="${p.resumeUrl}" style="display:inline-block;padding:11px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:7px;font-weight:700;">回到 session</a></p>
      <p style="font-size:12px;color:#64748b;word-break:break-all;">${p.resumeUrl}</p>
    </body></html>`,
  });
  return true;
}

export async function sendResultEmail(p: {
  to: string;
  title: string;
  resumeUrl: string;
  markdown: string;
}): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;
  await tx.sendMail({
    from: from(),
    to: p.to,
    subject: `AI Brainstorming review 完成：${p.title.slice(0, 80)}`,
    text: `AI Brainstorming review 完成\n\n${p.resumeUrl}\n\n${p.markdown}`,
    html: `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#18212f;background:#fbfaf7;">
      <h2 style="margin:0 0 8px;color:#14213d;">AI Brainstorming review 完成</h2>
      <p><a href="${p.resumeUrl}" style="display:inline-block;padding:10px 15px;background:#0f766e;color:#fff;text-decoration:none;border-radius:7px;font-weight:700;">打開完整 session</a></p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:18px;">${markdownToEmailHtml(p.markdown)}</div>
      <p style="font-size:12px;color:#64748b;">Markdown 原檔已附在這封信。</p>
    </body></html>`,
    attachments: [{ filename: 'idea-review.md', content: p.markdown, contentType: 'text/markdown; charset=utf-8' }],
  });
  return true;
}
