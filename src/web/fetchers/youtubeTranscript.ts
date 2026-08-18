import { getWebConfig } from '../store'
import { youtubeVideoIdFromUrl } from '../youtube'
import type { FetchedArticle } from './article'
import { clip, combinedSignal } from './http'

const MAX_BODY = 3600
const MIN_BODY = 40
const MARKER = 'YOUTUBE_TRANSCRIPT_V1'

type CaptionTrack = {
  baseUrl: string
  languageCode: string
  kind: string
}

export async function fetchYoutubeTranscript(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedArticle> {
  const videoId = youtubeVideoIdFromUrl(url)
  if (!videoId) {
    throw new Error('That YouTube link is not a single video, so there is no transcript.')
  }

  const langs = preferredLangs()
  const fromTracks = await tryCaptionTracks(videoId, langs, signal)
  if (fromTracks) return fromTracks

  const fromPanel = await tryTranscriptPanel(videoId, signal)
  if (fromPanel) return fromPanel

  const fromPlayer = await tryInnerTubeInject(videoId, langs, signal)
  if (fromPlayer) return fromPlayer

  throw new Error('This YouTube video has no captions to load.')
}

function preferredLangs(): string[] {
  const raw = (typeof navigator !== 'undefined' ? navigator.language : 'en')
    .trim()
    .toLowerCase()
  const base = raw.split('-')[0] || 'en'
  return [...new Set([raw, base, 'en'].filter(Boolean))]
}

async function tryCaptionTracks(
  videoId: string,
  langs: string[],
  signal?: AbortSignal,
): Promise<FetchedArticle | null> {
  const html = await jinaGet(`https://www.youtube.com/watch?v=${videoId}`, {
    format: 'html',
    engine: 'direct',
    signal,
    timeoutMs: 25_000,
  }).catch(() => '')
  if (!html) return null
  const player = extractPlayerResponse(html)
  const tracks = captionTracksOf(player)
  if (!tracks.length) return null
  const track = pickTrack(tracks, langs)
  if (!track) return null
  const raw = await downloadCaptionFile(track.baseUrl, signal)
  const body = captionToText(raw)
  if (body.length < MIN_BODY) return null
  const title =
    playerTitle(player) || titleFromHtml(html) || 'YouTube'
  return { title, body: clip(body, MAX_BODY) }
}

async function tryTranscriptPanel(
  videoId: string,
  signal?: AbortSignal,
): Promise<FetchedArticle | null> {
  const raw = await jinaPost(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      scripts: [TRANSCRIPT_CLICK_SCRIPT],
      targetSelector:
        'ytd-transcript-segment-list-renderer, ytd-transcript-segment-renderer',
      timeoutMs: 50_000,
      signal,
    },
  ).catch(() => '')
  if (!raw) return null
  return panelToTranscript(raw)
}

async function tryInnerTubeInject(
  videoId: string,
  langs: string[],
  signal?: AbortSignal,
): Promise<FetchedArticle | null> {
  const raw = await jinaPost(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      scripts: [captionExtractScript(videoId, langs)],
      targetSelector: '#faces-transcript, article',
      timeoutMs: 50_000,
      signal,
    },
  ).catch(() => '')
  if (!raw) return null
  return parseMarkedTranscript(raw)
}

const TRANSCRIPT_CLICK_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.offsetParent !== null;
  for (let i = 0; i < 24; i++) {
    const btn =
      document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      document.querySelector('button[aria-label="Show transcript"]') ||
      document.querySelector('button[aria-label="Show transcription"]');
    if (visible(btn) || btn) {
      btn.click();
      return true;
    }
    await sleep(250);
  }
  const more =
    document.querySelector('#actions button[aria-label="More actions"]') ||
    document.querySelector('ytd-menu-renderer button[aria-label="More actions"]');
  if (!more) return false;
  more.click();
  await sleep(500);
  const items = document.querySelectorAll(
    'ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model, yt-formatted-string',
  );
  for (const el of items) {
    if (/transcript/i.test(el.textContent || '')) {
      el.click();
      return true;
    }
  }
  return false;
})()`

function captionExtractScript(videoId: string, langs: string[]): string {
  const id = JSON.stringify(videoId)
  const langList = JSON.stringify(langs)
  const marker = JSON.stringify(MARKER)
  return `(async () => {
  try {
    const langs = ${langList};
    const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId: ${id},
      }),
    });
    const data = await res.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    let best = null;
    let score = -1;
    for (const track of tracks) {
      const code = String(track.languageCode || '').toLowerCase();
      let n = 0;
      const i = langs.indexOf(code);
      if (i >= 0) n += 40 - i;
      else if (langs.some((l) => code.startsWith(l))) n += 8;
      if (track.kind !== 'asr') n += 6;
      if (n > score) { score = n; best = track; }
    }
    const track = best || tracks[0];
    if (!track || !track.baseUrl) {
      document.body.replaceChildren();
      const el = document.createElement('article');
      el.id = 'faces-transcript';
      el.textContent = 'NO_YOUTUBE_CAPTIONS';
      document.body.appendChild(el);
      return;
    }
    const capUrl = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=vtt';
    const captions = await fetch(capUrl).then((r) => r.text());
    const title = (data?.videoDetails?.title || '').trim();
    document.body.replaceChildren();
    const el = document.createElement('article');
    el.id = 'faces-transcript';
    el.textContent = ${marker} + '\\n' + title + '\\n' + captions;
    document.body.appendChild(el);
  } catch {
    document.body.replaceChildren();
    const el = document.createElement('article');
    el.id = 'faces-transcript';
    el.textContent = 'NO_YOUTUBE_CAPTIONS';
    document.body.appendChild(el);
  }
})()`
}

function extractPlayerResponse(html: string): unknown {
  const unwrapped = unwrapHtml(html)
  const named = unwrapped.match(/ytInitialPlayerResponse\s*=\s*/)
  if (named && named.index != null) {
    const start = unwrapped.indexOf('{', named.index + named[0].length - 1)
    const parsed = extractBalancedJson(unwrapped, start)
    if (parsed) return parsed
  }
  const key = unwrapped.indexOf('"captionTracks"')
  if (key < 0) return null
  const colon = unwrapped.indexOf(':', key)
  const start = unwrapped.indexOf('[', colon)
  const tracks = extractBalancedJson(unwrapped, start)
  if (Array.isArray(tracks)) return { captionTracks: tracks }
  return null
}

function unwrapHtml(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n')
  const marker = text.search(/^HTML Content:\s*$/m)
  if (marker >= 0) return text.slice(marker).replace(/^HTML Content:\s*/m, '')
  if (text.trim().startsWith('{')) {
    try {
      const data = JSON.parse(text) as {
        data?: { html?: unknown; content?: unknown }
        html?: unknown
      }
      const html =
        (typeof data.data?.html === 'string' && data.data.html) ||
        (typeof data.html === 'string' && data.html) ||
        (typeof data.data?.content === 'string' && data.data.content) ||
        ''
      if (html.includes('ytInitialPlayerResponse') || html.includes('captionTracks')) {
        return html
      }
    } catch {
      /* use raw */
    }
  }
  return text
}

function extractBalancedJson(source: string, start: number): unknown | null {
  if (start < 0 || (source[start] !== '{' && source[start] !== '[')) return null
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return null
      if (!stack.length) {
        try {
          return JSON.parse(source.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function captionTracksOf(player: unknown): CaptionTrack[] {
  const tracks = walkForTracks(player)
  const out: CaptionTrack[] = []
  for (const raw of tracks) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    const baseUrl = typeof t.baseUrl === 'string' ? t.baseUrl.trim() : ''
    if (!baseUrl) continue
    out.push({
      baseUrl: baseUrl.startsWith('//') ? `https:${baseUrl}` : baseUrl,
      languageCode: typeof t.languageCode === 'string' ? t.languageCode : '',
      kind: typeof t.kind === 'string' ? t.kind : '',
    })
  }
  return out
}

function walkForTracks(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkForTracks(item)
      if (found.length) return found
    }
    return []
  }
  const rec = value as Record<string, unknown>
  if (Array.isArray(rec.captionTracks)) return rec.captionTracks
  const nested = rec.playerCaptionsTracklistRenderer
  if (nested && typeof nested === 'object') {
    const tracks = (nested as { captionTracks?: unknown }).captionTracks
    if (Array.isArray(tracks)) return tracks
  }
  for (const child of Object.values(rec)) {
    const found = walkForTracks(child)
    if (found.length) return found
  }
  return []
}

function pickTrack(tracks: CaptionTrack[], langs: string[]): CaptionTrack | null {
  let best: CaptionTrack | null = null
  let score = -1
  for (const track of tracks) {
    const code = track.languageCode.toLowerCase()
    let n = 0
    const i = langs.indexOf(code)
    if (i >= 0) n += 40 - i
    else if (langs.some((lang) => code.startsWith(lang))) n += 8
    if (track.kind !== 'asr') n += 6
    if (n > score) {
      score = n
      best = track
    }
  }
  return best ?? tracks[0] ?? null
}

function playerTitle(player: unknown): string {
  if (!player || typeof player !== 'object') return ''
  const details = (player as { videoDetails?: { title?: unknown } }).videoDetails
  return typeof details?.title === 'string' ? details.title.trim() : ''
}

function titleFromHtml(html: string): string {
  const m = html.match(/<title>([^<]+)<\/title>/i)
  return (m?.[1] ?? '').replace(/\s*-\s*YouTube\s*$/i, '').trim()
}

async function downloadCaptionFile(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  for (const fmt of ['json3', 'vtt', 'srv3'] as const) {
    const href = withFmt(baseUrl, fmt)
    const direct = await tryFetchText(href, signal)
    if (looksLikeCaptions(direct)) return direct
    const viaJina = await jinaGet(href, {
      format: 'text',
      engine: 'direct',
      signal,
      timeoutMs: 20_000,
    }).catch(() => '')
    if (looksLikeCaptions(viaJina)) return viaJina
  }
  return ''
}

function withFmt(url: string, fmt: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('fmt', fmt)
    return parsed.toString()
  } catch {
    const join = url.includes('?') ? '&' : '?'
    return `${url}${join}fmt=${fmt}`
  }
}

function looksLikeCaptions(raw: string): boolean {
  const t = raw.trim()
  if (t.length < 20) return false
  return (
    t.startsWith('WEBVTT') ||
    t.startsWith('{') ||
    /<timedtext\b|<transcript\b|<text\b|<p\b/i.test(t)
  )
}

async function tryFetchText(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(url, { signal: combinedSignal(signal, 15_000) })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function parseMarkedTranscript(raw: string): FetchedArticle | null {
  const text = stripJinaChrome(raw)
  if (!text || /^NO_YOUTUBE_CAPTIONS\b/m.test(text)) return null
  const idx = text.indexOf(MARKER)
  if (idx < 0) return null
  const rest = text.slice(idx + MARKER.length).replace(/^\s*\n/, '')
  const nl = rest.indexOf('\n')
  const title = (nl >= 0 ? rest.slice(0, nl) : rest).trim() || 'YouTube'
  const captions = captionToText(nl >= 0 ? rest.slice(nl + 1) : '')
  if (captions.length < MIN_BODY) return null
  return { title, body: clip(captions, MAX_BODY) }
}

function panelToTranscript(raw: string): FetchedArticle | null {
  const text = stripJinaChrome(raw)
  if (!text) return null
  const titleMatch = raw.match(/^Title:\s*(.+)$/m)
  const title = (titleMatch?.[1] ?? '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .trim() || 'YouTube'
  const cues: string[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/^(\d+:)?\d{1,2}:\d{2}(\.\d+)?$/.test(t)) continue
    if (
      /^(subscribe|subscribed|share|save|join|show more|show less|transcript|description|views?|comments?)\b/i.test(
        t,
      )
    ) {
      continue
    }
    pushCue(cues, t.replace(/^((?:\d+:)?\d{1,2}:\d{2})\s+/, ''))
  }
  const body = clip(cues.join(' '), MAX_BODY)
  if (body.length < MIN_BODY) return null
  if (!/\s/.test(body) && body.length < 80) return null
  return { title, body }
}

function captionToText(raw: string): string {
  const text = stripJinaChrome(raw).replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  if (/^\s*\{/.test(text)) {
    const fromJson = json3ToText(text)
    if (fromJson) return fromJson
  }
  if (/<timedtext\b|<transcript\b|<text\b|<p\s/i.test(text)) {
    const fromXml = xmlCaptionsToText(text)
    if (fromXml) return fromXml
  }
  return vttToText(text)
}

function json3ToText(raw: string): string {
  try {
    const data = JSON.parse(raw) as {
      events?: { segs?: { utf8?: string }[] }[]
    }
    const lines: string[] = []
    for (const event of data.events ?? []) {
      const piece = (event.segs ?? [])
        .map((seg) => decodeEntities(seg.utf8 ?? ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      pushCue(lines, piece)
    }
    return lines.join(' ')
  } catch {
    return ''
  }
}

function xmlCaptionsToText(raw: string): string {
  const lines: string[] = []
  const chunks = raw.matchAll(/<(?:p|text)\b[^>]*>([\s\S]*?)<\/(?:p|text)>/gi)
  for (const chunk of chunks) {
    const inner = decodeEntities(chunk[1] ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    pushCue(lines, inner)
  }
  return lines.join(' ')
}

function vttToText(raw: string): string {
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (
      /^(WEBVTT|NOTE|STYLE|KIND|LANGUAGE)\b/i.test(t) ||
      /^\d+$/.test(t) ||
      t.includes('-->') ||
      /^\d{1,2}:\d{2}/.test(t)
    ) {
      continue
    }
    const cue = decodeEntities(t)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    pushCue(lines, cue)
  }
  return lines.join(' ')
}

function pushCue(lines: string[], cue: string): void {
  if (!cue || cue === lines[lines.length - 1]) return
  lines.push(cue)
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    })
}

function stripJinaChrome(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim()
  const marker = text.search(/^Markdown Content:\s*$/m)
  if (marker >= 0) {
    return text.slice(marker).replace(/^Markdown Content:\s*/m, '').trim()
  }
  return text
    .replace(/^Title:\s*.+$/m, '')
    .replace(/^URL Source:\s*.+$/m, '')
    .replace(/^Published Time:\s*.+$/m, '')
    .replace(/^Warning:\s*.+$/m, '')
    .trim()
}

async function jinaGet(
  url: string,
  opts: {
    format?: 'html' | 'text' | 'markdown'
    engine?: 'direct' | 'browser'
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<string> {
  const key = getWebConfig().jinaApiKey.trim()
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`
  if (opts.format) headers['X-Return-Format'] = opts.format
  if (opts.engine) headers['X-Engine'] = opts.engine
  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal: combinedSignal(opts.signal, opts.timeoutMs ?? 20_000),
    headers,
  })
  const raw = await res.text()
  throwIfJinaFailed(res.status, raw, key)
  if (opts.format === 'html') return unwrapHtml(raw)
  return jinaPayloadText(raw)
}

async function jinaPost(
  url: string,
  opts: {
    scripts: string[]
    targetSelector?: string
    timeoutMs: number
    signal?: AbortSignal
  },
): Promise<string> {
  const key = getWebConfig().jinaApiKey.trim()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Timeout': String(Math.ceil(opts.timeoutMs / 1000)),
  }
  if (key) headers.Authorization = `Bearer ${key}`
  if (opts.targetSelector) headers['X-Target-Selector'] = opts.targetSelector
  const res = await fetch('https://r.jina.ai/', {
    method: 'POST',
    signal: combinedSignal(opts.signal, opts.timeoutMs + 5_000),
    headers,
    body: JSON.stringify({
      url,
      injectPageScript: opts.scripts,
    }),
  })
  const raw = await res.text()
  throwIfJinaFailed(res.status, raw, key)
  return jinaPayloadText(raw)
}

function throwIfJinaFailed(status: number, raw: string, key: string): void {
  if (status === 401 || jinaAuthError(raw)) {
    throw new Error(
      key
        ? 'Jina API key is invalid.'
        : 'Add a Jina API key in Settings → News (jina.ai). Anonymous article reads are blocked on this network.',
    )
  }
  if (status === 429) {
    throw new Error('Article reader is rate-limited. Try again in a minute.')
  }
  if (status >= 400) {
    throw new Error(`Could not read YouTube captions (HTTP ${status}).`)
  }
}

function jinaPayloadText(raw: string): string {
  const t = raw.trim()
  if (!t.startsWith('{')) return t
  try {
    const data = JSON.parse(t) as {
      data?: { content?: unknown; text?: unknown; html?: unknown }
      content?: unknown
    }
    const inner = data.data
    const content =
      (typeof inner?.content === 'string' && inner.content) ||
      (typeof inner?.text === 'string' && inner.text) ||
      (typeof inner?.html === 'string' && inner.html) ||
      (typeof data.content === 'string' && data.content) ||
      ''
    return content.trim() || t
  } catch {
    return t
  }
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
