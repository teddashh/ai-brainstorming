import { modelFor, participantName, type Participant, type Phase } from './models.js';

export interface StepResult {
  provider: Participant;
  round: number;
  text: string;
}

function phaseLabel(phase: Phase): string {
  if (phase === 'research_thesis') return '搜尋立論';
  if (phase === 'clash') return '互相攻防';
  return '漸進收斂';
}

function renderHistory(history: StepResult[]): string {
  if (history.length === 0) return '';
  const recent = history.slice(-10);
  return `\n\n目前討論紀錄:\n${recent
    .map((h) => `[R${h.round} ${participantName(h.provider)}]\n${h.text.slice(0, 1200)}`)
    .join('\n\n---\n\n')}`;
}

function sanitizeModelText(text: string): string {
  const blocked = /\b(system prompt|workflow|searxng)\b|提示詞|系統提示/i;
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !blocked.test(p));
  const seen = new Set<string>();
  const deduped = paragraphs.filter((p) => {
    const key = p.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (deduped.length > 0 ? deduped : [text.trim()]).join('\n\n');
}

export function buildPrompt(args: {
  idea: string;
  participant: Participant;
  round: number;
  totalRounds: number;
  phase: Phase;
  evidence: string;
  history: StepResult[];
}): string {
  const name = participantName(args.participant);
  return `你是 ${name}，正在參與一個產品/創業 idea 的團隊審查。

規則:
- 全篇使用繁體中文。
- 不要提到 system prompt、workflow、工具或這些規則。
- 不要只叫使用者驗證；除非真的阻擋判斷，否則要給明確取捨。
- 直接回應 idea 的可行性、風險、反例、下一步。
- 控制在 350-650 字。
- 輸出可用 Markdown，但不要包 code fence。

階段: 第 ${args.round}/${args.totalRounds} 輪，${phaseLabel(args.phase)}
Idea:
${args.idea}

${args.evidence}
${renderHistory(args.history)}

請給出你的本輪判斷。`;
}

export async function callParticipant(
  participant: Participant,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'http-referer': process.env.OPENROUTER_SITE_URL || process.env.PUBLIC_URL || 'http://localhost:3001',
      'x-title': process.env.OPENROUTER_APP_NAME || 'AI Brainstorming',
    },
    body: JSON.stringify({
      model: modelFor[participant],
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
      max_tokens: 1800,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${participantName(participant)} failed: ${res.status} ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = sanitizeModelText(data.choices?.[0]?.message?.content?.trim() || '');
  if (!text) throw new Error(`${participantName(participant)} returned empty response`);
  return text;
}
