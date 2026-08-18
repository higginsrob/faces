import { hostLabel } from '../links'
import { getWebConfig } from '../store'
import { clip, combinedSignal } from './http'

const MAX_BODY = 3600
const MIN_BODY = 180
const PAYWALL =
  /subscribe to (continue|read)|become a subscriber|this article is for subscribers|sign in to (continue|read)|create a free account|paywall/i

export type FetchedArticle = {
  title: string
  body: string
}

export async function fetchArticleText(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedArticle> {
  const key = getWebConfig().jinaApiKey.trim()
  const headers: HeadersInit = {}
  if (key) headers.Authorization = `Bearer ${key}`
  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal: combinedSignal(signal, 20_000),
    headers,
  })
  const raw = await res.text()
  const authError = jinaAuthError(raw)
  if (res.status === 401 || authError) {
    throw new Error(
      key
        ? 'Jina API key is invalid.'
        : 'Add a Jina API key in Settings → News (jina.ai). Anonymous article reads are blocked on this network.',
    )
  }
  if (res.status === 429) {
    throw new Error('Article reader is rate-limited. Try again in a minute.')
  }
  if (!res.ok) {
    throw new Error(
      res.status === 451 || res.status === 403
        ? `Could not read ${hostLabel(url)} (blocked or paywalled).`
        : `Could not read ${hostLabel(url)} (HTTP ${res.status}).`,
    )
  }
  const parsed = parseJina(raw, url)
  if (!parsed) {
    throw new Error(
      `Could not extract the article at ${hostLabel(url)}. It may be paywalled.`,
    )
  }
  return parsed
}

function jinaAuthError(raw: string): boolean {
  const t = raw.trim()
  if (!t.startsWith('{')) return false
  try {
    const data = JSON.parse(t) as { name?: unknown; code?: unknown }
    return data.name === 'AuthenticationRequiredError' || data.code === 401
  } catch {
    return false
  }
}

function parseJina(raw: string, url: string): FetchedArticle | null {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return null
  const titleMatch = text.match(/^Title:\s*(.+)$/m)
  const title = (titleMatch?.[1] ?? '').trim() || hostLabel(url)
  const marker = text.search(/^Markdown Content:\s*$/m)
  const markdown =
    marker >= 0 ? text.slice(marker).replace(/^Markdown Content:\s*/m, '') : text
  const body = cleanArticle(markdown)
  if (body.length < MIN_BODY) return null
  if (PAYWALL.test(body) && body.length < 800) return null
  return { title, body: clipArticle(body, MAX_BODY) }
}

function cleanArticle(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^Title:\s*.+$/m, ' ')
    .replace(/^URL Source:\s*.+$/m, ' ')
    .replace(/^Published Time:\s*.+$/m, ' ')
    .replace(/^Warning:\s*.+$/m, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`]{1,3}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function clipArticle(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const para = cut.lastIndexOf('\n\n')
  if (para > max * 0.55) return `${cut.slice(0, para).trim()}…`
  return clip(cut, max)
}
