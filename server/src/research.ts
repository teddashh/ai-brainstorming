interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
}

function clip(s: string, n = 220): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n)}...` : clean;
}

export async function buildResearchBundle(idea: string, signal?: AbortSignal): Promise<string> {
  const base = process.env.SEARXNG_URL?.replace(/\/$/, '');
  if (!base) {
    return 'Evidence bundle: not configured. Treat all claims as hypotheses and avoid pretending external validation was performed.';
  }
  const queries = [
    idea.slice(0, 160),
    `${idea.slice(0, 120)} market risk`,
    `${idea.slice(0, 120)} competitors`,
  ];
  const seen = new Set<string>();
  const rows: Array<{ title: string; url: string; snippet: string }> = [];
  for (const q of queries) {
    const url = `${base}/search?q=${encodeURIComponent(q)}&format=json`;
    try {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: SearxResult[] };
      for (const r of data.results || []) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        rows.push({
          title: r.title || r.url,
          url: r.url,
          snippet: clip(r.content || ''),
        });
        if (rows.length >= 9) break;
      }
    } catch {
      // Search is helpful, not required.
    }
    if (rows.length >= 9) break;
  }
  if (rows.length === 0) {
    return 'Evidence bundle: no results found. Treat all claims as hypotheses and avoid pretending external validation was performed.';
  }
  return [
    'Evidence bundle (weak external context; do not over-weight it):',
    ...rows.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`),
  ].join('\n');
}

