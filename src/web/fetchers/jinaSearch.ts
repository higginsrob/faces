import { hostLabel } from '../links'
import { getWebConfig } from '../store'
import type { WebItem, WebItemSource } from '../types'
import { clip, combinedSignal, itemId } from './http'

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export type JinaHit = {
  title?: string
  url?: string
  description?: string
  content?: string
  date?: string
  publishedTime?: string
}

type JinaSearchResponse = {
  data?: JinaHit[] | null
  code?: number
  message?: string
  readableMessage?: string
  name?: string
}

export function hasJinaKey(): boolean {
  return Boolean(getWebConfig().jinaApiKey.trim())
}

export function requireJinaKey(): string {
  const key = getWebConfig().jinaApiKey.trim()
  if (!key) {
    throw new Error(
      'Add a Jina API key in Settings → News (jina.ai).',
    )
  }
  return key
}

export function isFatalJinaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /API key|invalid/i.test(msg)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const id = globalThis.setTimeout(resolve, ms)
    const onAbort = () => {
      globalThis.clearTimeout(id)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function parseHitDate(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}

function isRecent(iso: string | undefined): boolean {
  if (!iso) return true
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return true
  const age = Date.now() - ms
  return age >= -60 * 60 * 1000 && age <= MAX_AGE_MS
}

function shortDate(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(ms))
}

function skipUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'jina.ai' || host.endsWith('.jina.ai')) return true
    if (host === 'bing.com' || host.endsWith('.bing.com')) return true
    if (host === 'duckduckgo.com') return true
    if (host === 'google.com' || host.endsWith('.google.com')) {
      return !host.startsWith('news.google')
    }
    return false
  } catch {
    return true
  }
}

export async function jinaSearch(
  query: string,
  opts?: {
    location?: string
    lang?: string
    country?: string
    tbs?: string
    signal?: AbortSignal
  },
): Promise<JinaHit[]> {
  const q = query.trim()
  if (!q) return []
  const key = requireJinaKey()
  const body: Record<string, string | number> = {
    q,
    num: 10,
    tbs: opts?.tbs?.trim() || 'qdr:w',
  }
  if (opts?.location?.trim()) body.location = opts.location.trim()
  if (opts?.country?.trim()) body.gl = opts.country.trim()
  if (opts?.lang?.trim()) body.hl = opts.lang.trim()

  const once = async () => {
    const res = await fetch('https://s.jina.ai/', {
      method: 'POST',
      signal: combinedSignal(opts?.signal, 20_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-Respond-With': 'no-content',
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as JinaSearchResponse
    return { res, data }
  }

  let { res, data } = await once()
  if (res.status === 429) {
    await delay(2500, opts?.signal)
    ;({ res, data } = await once())
  }
  if (res.status === 401 || data.name === 'AuthenticationRequiredError') {
    throw new Error('Jina API key is invalid.')
  }
  if (res.status === 429) {
    throw new Error('Jina search is rate-limited. Try again later.')
  }
  if (!res.ok) {
    throw new Error(
      data.readableMessage?.trim() ||
        data.message?.trim() ||
        `Jina search failed: HTTP ${res.status}`,
    )
  }
  return Array.isArray(data.data) ? data.data : []
}

export function jinaHitsToItems(
  hits: JinaHit[],
  source: WebItemSource,
  limit: number,
  topic?: string,
): WebItem[] {
  const out: WebItem[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const title = (hit.title ?? '').replace(/\s+/g, ' ').trim()
    const url = (hit.url ?? '').trim()
    if (!title || !url || skipUrl(url)) continue
    const publishedAt = parseHitDate(hit.publishedTime || hit.date)
    if (!isRecent(publishedAt)) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const when = shortDate(publishedAt)
    const outlet = hostLabel(url)
    const desc = (hit.description ?? hit.content ?? '').trim()
    const blurb = [when, outlet, desc].filter(Boolean).join(' · ')
    const item: WebItem = {
      id: itemId(source, `${topic ?? ''}-${title}`),
      source,
      title,
      blurb: clip(blurb || title),
      url,
    }
    if (topic) item.topic = topic
    if (publishedAt) item.publishedAt = publishedAt
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}
