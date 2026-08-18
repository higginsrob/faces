import { youtubePosterUrls, youtubeVideoIdFromUrl } from './youtube'

export function httpImageUrl(
  raw: unknown,
  pageUrl?: string,
): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (!value || value.startsWith('data:')) return undefined
  try {
    const url = new URL(value, pageUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export function firstHttpImage(
  raw: unknown,
  pageUrl?: string,
  depth = 0,
): string | undefined {
  if (depth > 3 || raw == null) return undefined
  if (typeof raw === 'string') return httpImageUrl(raw, pageUrl)
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const url = firstHttpImage(entry, pageUrl, depth + 1)
      if (url) return url
    }
    return undefined
  }
  if (typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const named = [
    o['og:image'],
    o['og:image:url'],
    o['twitter:image'],
    o['twitter:image:src'],
    o.ogImage,
    o.image,
    o.imageUrl,
    o.thumbnail,
    o.thumbnailUrl,
    o.source,
    o.url,
  ]
  for (const value of named) {
    const url = firstHttpImage(value, pageUrl, depth + 1)
    if (url) return url
  }
  for (const value of Object.values(o)) {
    const url = firstHttpImage(value, pageUrl, depth + 1)
    if (url) return url
  }
  return undefined
}

export function markdownHeroImage(
  markdown: string,
  pageUrl?: string,
): string | undefined {
  const match = markdown.match(/!\[[^\]]*]\(\s*<?([^)\s>]+)/)
  return match?.[1] ? httpImageUrl(match[1], pageUrl) : undefined
}

export function storyPreviewSources(item: {
  url?: string
  imageUrl?: string
}): string[] {
  if (item.url && youtubeVideoIdFromUrl(item.url)) {
    return youtubePosterUrls(item.url)
  }
  const stored = item.imageUrl ? httpImageUrl(item.imageUrl) : undefined
  return stored ? [stored] : []
}

export function storyPreviewImage(item: {
  url?: string
  imageUrl?: string
}): string | null {
  return storyPreviewSources(item)[0] ?? null
}
