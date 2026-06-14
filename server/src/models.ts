export type Participant = 'claude' | 'gemini' | 'grok' | 'chatgpt' | 'deepseek';
export type RoundCount = 5 | 12 | 16;
export type Phase = 'research_thesis' | 'clash' | 'converge';

export const participants: Participant[] = ['claude', 'gemini', 'grok', 'chatgpt', 'deepseek'];

export const participantDisplay: Record<Participant, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  chatgpt: 'ChatGPT',
  deepseek: 'DeepSeek',
};

export function participantName(p: Participant): string {
  return participantDisplay[p] ?? p;
}

export const modelFor: Record<Participant, string> = {
  claude: process.env.MODEL_CLAUDE || 'anthropic/claude-sonnet-4',
  gemini: process.env.MODEL_GEMINI || 'google/gemini-2.5-pro',
  grok: process.env.MODEL_GROK || 'x-ai/grok-4',
  chatgpt: process.env.MODEL_CHATGPT || 'openai/gpt-4o',
  deepseek: process.env.MODEL_DEEPSEEK || 'deepseek/deepseek-r1',
};

export function normalizeRoundCount(value: unknown): RoundCount {
  const n = typeof value === 'string' ? Number(value) : value;
  return n === 5 || n === 12 || n === 16 ? n : 5;
}

export function schedule(roundCount: RoundCount): Phase[] {
  const counts: Record<RoundCount, [number, number, number]> = {
    5: [1, 3, 1],
    12: [2, 8, 2],
    16: [3, 10, 3],
  };
  const [research, clash, converge] = counts[roundCount];
  return [
    ...Array<Phase>(research).fill('research_thesis'),
    ...Array<Phase>(clash).fill('clash'),
    ...Array<Phase>(converge).fill('converge'),
  ];
}

