const VIDEO_ID = /^[\w-]{11}$/
const LIST_ID = /^[\w-]{10,}$/

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

function youtubeHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, '').toLowerCase()
  return (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be' ||
    host === 'youtube-nocookie.com'
  )
}

export function isYouTubeUrl(url: string): boolean {
  const parsed = parseHttpUrl(url)
  return Boolean(parsed && youtubeHost(parsed.hostname))
}

export function youtubeVideoIdFromUrl(url: string): string | null {
  const parsed = parseHttpUrl(url)
  if (!parsed || !youtubeHost(parsed.hostname)) return null
  return youtubeVideoId(parsed)
}

/** Poster stills, largest first. Smaller sizes always exist; maxres can 404. */
export function youtubePosterUrls(url: string): string[] {
  const id = youtubeVideoIdFromUrl(url)
  if (!id) return []
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ]
}

function pathParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

function videoIdFromPath(pathname: string, kind: 'shorts' | 'live' | 'embed'): string | null {
  const parts = pathParts(pathname)
  if (parts[0]?.toLowerCase() !== kind) return null
  const id = parts[1] ?? ''
  if (kind === 'embed' && id.toLowerCase() === 'videoseries') return null
  return VIDEO_ID.test(id) ? id : null
}

function youtubeVideoId(parsed: URL): string | null {
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
  if (host === 'youtu.be') {
    const id = pathParts(parsed.pathname)[0] ?? ''
    return VIDEO_ID.test(id) ? id : null
  }
  const v = parsed.searchParams.get('v')?.trim() ?? ''
  if (VIDEO_ID.test(v)) return v
  return (
    videoIdFromPath(parsed.pathname, 'shorts') ??
    videoIdFromPath(parsed.pathname, 'live') ??
    videoIdFromPath(parsed.pathname, 'embed')
  )
}

function youtubePlaylistId(parsed: URL): string | null {
  const list = parsed.searchParams.get('list')?.trim() ?? ''
  return LIST_ID.test(list) ? list : null
}

function hashStartParam(hash: string): string | null {
  const body = hash.replace(/^#/, '')
  if (!body) return null
  const params = new URLSearchParams(body.includes('=') ? body : `t=${body}`)
  return params.get('t')
}

/** Seconds from `t`, `start`, or YouTube's `1h2m3s` form. */
export function youtubeStartSeconds(url: string): number | undefined {
  const parsed = parseHttpUrl(url)
  if (!parsed) return undefined
  const raw =
    parsed.searchParams.get('t') ??
    parsed.searchParams.get('start') ??
    hashStartParam(parsed.hash)
  if (!raw) return undefined
  const compact = raw.trim().replace(/s$/i, '')
  if (/^\d+$/.test(compact)) {
    const n = Number(compact)
    return n > 0 ? n : undefined
  }
  const match = compact.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i)
  if (!match) return undefined
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = Number(match[3] ?? 0)
  const total = hours * 3600 + minutes * 60 + seconds
  return total > 0 ? total : undefined
}

export const YOUTUBE_EMBED_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

function withStart(src: string, start: number | undefined): string {
  if (!start) return src
  const url = new URL(src)
  url.searchParams.set('start', String(start))
  return url.toString()
}

function withEmbedParams(src: string, opts?: { autoplay?: boolean }): string {
  if (!opts?.autoplay) return src
  const url = new URL(src)
  url.searchParams.set('autoplay', '1')
  url.searchParams.set('playsinline', '1')
  return url.toString()
}

/** Embeddable iframe src, or null for channels/home/other non-video pages. */
export function youtubeEmbedSrc(
  url: string,
  opts?: { autoplay?: boolean },
): string | null {
  const parsed = parseHttpUrl(url)
  if (!parsed || !youtubeHost(parsed.hostname)) return null
  const start = youtubeStartSeconds(url)
  const video = youtubeVideoId(parsed)
  if (video) {
    return withEmbedParams(
      withStart(`https://www.youtube.com/embed/${video}`, start),
      opts,
    )
  }
  const list = youtubePlaylistId(parsed)
  if (list) {
    const src = new URL('https://www.youtube.com/embed/videoseries')
    src.searchParams.set('list', list)
    return withEmbedParams(withStart(src.toString(), start), opts)
  }
  return null
}

/** Stable viewer tab id so watch / youtu.be / embed of the same clip share a tab. */
export function youtubeTabId(url: string): string | null {
  const parsed = parseHttpUrl(url)
  if (!parsed || !youtubeHost(parsed.hostname)) return null
  const video = youtubeVideoId(parsed)
  if (video) return `youtube:video:${video}`
  const list = youtubePlaylistId(parsed)
  if (list) return `youtube:list:${list}`
  return null
}
