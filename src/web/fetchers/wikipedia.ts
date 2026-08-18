import type { WebItem } from '../types'
import {
  clip,
  combinedSignal,
  fetchJson,
  itemId,
  stripHtml,
} from './http'

type WikiLink = {
  title?: string
  extract?: string
  description?: string
  content_urls?: { desktop?: { page?: string } }
}

type FeaturedFeed = {
  news?: { story?: string; links?: WikiLink[] }[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function datePath(date: Date, utc: boolean): string {
  const y = utc ? date.getUTCFullYear() : date.getFullYear()
  const m = utc ? date.getUTCMonth() + 1 : date.getMonth() + 1
  const d = utc ? date.getUTCDate() : date.getDate()
  return `${y}/${pad(m)}/${pad(d)}`
}

function prettyTitle(title: string): string {
  return title.replace(/_/g, ' ').trim()
}

function wikiItem(
  title: string,
  blurb: string,
  url?: string,
): WebItem {
  const clean = prettyTitle(title)
  const item: WebItem = {
    id: itemId('national', clean),
    source: 'national',
    title: clean,
    blurb: clip(blurb || clean),
  }
  if (url) item.url = url
  return item
}

async function fetchFeatured(
  path: string,
  signal?: AbortSignal,
): Promise<FeaturedFeed> {
  return fetchJson<FeaturedFeed>(
    `https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`,
    combinedSignal(signal, 12_000),
  )
}

/** Editorial "In the news" only — not most-read encyclopedia pages. */
export async function fetchWikipediaInTheNews(
  signal?: AbortSignal,
): Promise<WebItem[]> {
  const now = new Date()
  const paths = [...new Set([datePath(now, false), datePath(now, true)])]
  let feed: FeaturedFeed | null = null
  for (const path of paths) {
    try {
      const next = await fetchFeatured(path, signal)
      feed = next
      if (next.news?.length) break
    } catch {
      // try the other calendar
    }
  }
  if (!feed?.news?.length) return []

  const items: WebItem[] = []
  const seen = new Set<string>()
  for (const story of feed.news) {
    const fallback = stripHtml(story.story ?? '')
    const link = story.links?.[0]
    const title = prettyTitle((link?.title ?? '').trim()) || clip(fallback, 80)
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(
      wikiItem(
        title,
        (link?.extract || link?.description || fallback || title).trim(),
        link?.content_urls?.desktop?.page,
      ),
    )
    if (items.length >= 3) break
  }
  return items
}
