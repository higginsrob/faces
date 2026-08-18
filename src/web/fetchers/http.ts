export function combinedSignal(
  parent: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!parent) return timeout
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([parent, timeout])
  }
  return parent
}

export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function clip(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > 80 ? cut.slice(0, sp) : cut).trim()}…`
}

export function itemId(source: string, key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${source}-${slug || 'item'}`
}

export function rankByTerms<T>(
  items: T[],
  terms: string[],
  textOf: (item: T) => string,
): T[] {
  if (!terms.length) return items
  return [...items].sort((a, b) => score(textOf(b), terms) - score(textOf(a), terms))
}

function score(text: string, terms: string[]): number {
  const hay = text.toLowerCase()
  let n = 0
  for (const term of terms) {
    if (hay.includes(term)) n += 1
  }
  return n
}
