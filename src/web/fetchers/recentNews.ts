import { topicArticleFits, topicSearchQuery } from '../topics'
import type { WebItem } from '../types'
import {
  hasJinaKey,
  isFatalJinaError,
  jinaHitsToItems,
  jinaSearch,
} from './jinaSearch'
import { fetchWikipediaInTheNews } from './wikipedia'

const PER_TOPIC = 10
const MAX_TOPIC_ITEMS = 80
const LOCAL_KEEP = 10
const NATIONAL_KEEP = 10

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

function newsLocale(): { lang: string; country: string } {
  const raw =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'en-US'
  const [langPart, regionPart] = raw.replace('_', '-').split('-')
  const lang = (langPart || 'en').toLowerCase()
  const country = (regionPart || 'us').toLowerCase()
  return {
    lang: /^[a-z]{2}$/.test(lang) ? lang : 'en',
    country: /^[a-z]{2}$/.test(country) ? country : 'us',
  }
}

function localPlaceQuery(location: string): { q: string; city: string } {
  const cleaned = location.trim().replace(/"/g, '').replace(/\s+/g, ' ')
  const parts = cleaned.split(/[,;/]+/).map((p) => p.trim()).filter(Boolean)
  const city = parts[0] ?? cleaned
  return { q: parts.join(' '), city }
}

function takeUnique(
  dest: WebItem[],
  seen: Set<string>,
  items: WebItem[],
  limit: number,
): void {
  for (const item of items) {
    const key = item.title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    dest.push(item)
    if (dest.length >= limit) return
  }
}

export async function fetchTopicsNews(
  topics: string[],
  signal?: AbortSignal,
): Promise<WebItem[]> {
  const list = topics.map((t) => t.trim()).filter(Boolean).slice(0, 8)
  if (!list.length) return []
  const { lang, country } = newsLocale()
  const out: WebItem[] = []
  const seen = new Set<string>()
  for (const topic of list) {
    const q = topicSearchQuery(topic)
    if (!q) continue
    let items: WebItem[] = []
    try {
      items = jinaHitsToItems(
        await jinaSearch(`${q} news`, { lang, country, signal }),
        'topic',
        PER_TOPIC,
        topic,
      )
    } catch (e) {
      if (isAbortError(e) || isFatalJinaError(e)) throw e
      continue
    }
    let kept = 0
    for (const item of items) {
      if (!topicArticleFits(`${item.title} ${item.blurb}`, topic)) continue
      const key = item.title.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
      kept += 1
      if (kept >= PER_TOPIC) break
      if (out.length >= MAX_TOPIC_ITEMS) return out
    }
  }
  return out
}

export async function fetchLocalNews(
  location: string,
  _terms: string[],
  signal?: AbortSignal,
): Promise<WebItem[]> {
  const place = location.trim()
  if (!place) throw new Error('Add a location in Profile to fetch local news.')
  const { q, city } = localPlaceQuery(place)
  if (!q) throw new Error('Add a location in Profile to fetch local news.')
  const { lang, country } = newsLocale()
  const seen = new Set<string>()
  const out: WebItem[] = []
  let lastError: unknown

  const search = async (query: string, where: string) => {
    takeUnique(
      out,
      seen,
      jinaHitsToItems(
        await jinaSearch(`${query} news`, {
          location: where,
          lang,
          country,
          signal,
        }),
        'local',
        LOCAL_KEEP,
      ),
      LOCAL_KEEP,
    )
  }

  try {
    await search(q, city || q)
  } catch (e) {
    if (isAbortError(e) || isFatalJinaError(e)) throw e
    lastError = e
  }
  if (out.length >= LOCAL_KEEP) return out

  const retryQ = city && city.toLowerCase() !== q.toLowerCase() ? city : ''
  if (retryQ) {
    try {
      await search(retryQ, retryQ)
    } catch (e) {
      if (isAbortError(e) || isFatalJinaError(e)) throw e
      lastError = e
    }
  }
  if (!out.length && lastError) throw lastError
  return out
}

export async function fetchNationalNews(
  _terms: string[],
  signal?: AbortSignal,
): Promise<WebItem[]> {
  if (!hasJinaKey()) return fetchWikipediaInTheNews(signal)
  const { lang, country } = newsLocale()
  try {
    const items = jinaHitsToItems(
      await jinaSearch('top news', {
        lang,
        country,
        tbs: 'qdr:d',
        signal,
      }),
      'national',
      NATIONAL_KEEP,
    )
    if (items.length) return items
  } catch (e) {
    if (isAbortError(e)) throw e
  }
  return fetchWikipediaInTheNews(signal)
}
