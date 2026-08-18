import { useSyncExternalStore } from 'react'
import { articlesKey, droppedKey } from '../profile/keys'
import {
  getActiveProfileId,
  getUserProfile,
  onProfileDidChange,
} from '../profile/store'
import { loadJson, saveJson } from '../storage'
import {
  isTtsBusy,
  isTtsPlaying,
  stopTts,
  subscribeTtsActivity,
} from '../voice/tts'
import { isConversationalItem, newsAccess } from './age'
import {
  articleSupportsClaim,
  droppedSourceMessage,
  type ArticleClaim,
} from './articleRelevance'
import { getWebDigest } from './digest'
import { fetchArticleText } from './fetchers/article'
import { fetchYoutubeTranscript } from './fetchers/youtubeTranscript'
import { hostLabel, parseNewsLinkLines } from './links'
import { itemMentionedInText } from './matchMention'
import { getWebConfig } from './store'
import { summarizeArticleForSpeech } from './summarize'
import type { OpenArticle, WebItem } from './types'
import { youtubeTabId, youtubeVideoIdFromUrl } from './youtube'

let KEY = articlesKey(getActiveProfileId())
let DROPPED_KEY = droppedKey(getActiveProfileId())
/** How many Read articles stay loaded for chat context at once. */
export const MAX_OPEN_ARTICLES = 5
const MAX_DROPPED = 200

export type ArticleShelf = {
  items: OpenArticle[]
  loadingUrl: string | null
  speakingUrl: string | null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeArticle(raw: unknown): OpenArticle | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<OpenArticle>
  const url = str(o.url).trim()
  const title = str(o.title).trim()
  const body = str(o.body).trim()
  if (!url || !title || !body) return null
  const spokenSummary = str(o.spokenSummary).trim()
  const kind = o.kind === 'transcript' ? 'transcript' : undefined
  return {
    url,
    title,
    host: str(o.host).trim() || hostLabel(url),
    body,
    fetchedAt: str(o.fetchedAt).trim() || new Date().toISOString(),
    ...(spokenSummary ? { spokenSummary } : {}),
    ...(kind ? { kind } : {}),
  }
}

function loadDroppedUrls(): string[] {
  const raw = loadJson<unknown>(DROPPED_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-MAX_DROPPED)
}

let droppedUrls = loadDroppedUrls()

export function isDroppedSourceUrl(url: string): boolean {
  const href = url.trim()
  if (!href) return false
  return droppedUrls.some((item) => sameArticleUrl(item, href))
}

function rememberDroppedUrl(url: string): void {
  const href = url.trim()
  if (!href || isDroppedSourceUrl(href)) return
  droppedUrls = [...droppedUrls, href].slice(-MAX_DROPPED)
  saveJson(DROPPED_KEY, droppedUrls)
  emit()
}

export function restoreDroppedSourceUrl(url: string): void {
  const href = url.trim()
  if (!href) return
  const next = droppedUrls.filter((item) => !sameArticleUrl(item, href))
  if (next.length === droppedUrls.length) return
  droppedUrls = next
  saveJson(DROPPED_KEY, droppedUrls)
  emit()
}

function disqualifySource(url: string): void {
  rememberDroppedUrl(url)
}

function loadShelfItems(): OpenArticle[] {
  const persisted = loadJson<OpenArticle[] | { items?: unknown } | null>(KEY, null)
  const rows = Array.isArray(persisted)
    ? persisted
    : persisted && typeof persisted === 'object' && Array.isArray(persisted.items)
      ? persisted.items
      : []
  return rows.map(normalizeArticle).filter((x): x is OpenArticle => x !== null)
}

const listeners = new Set<() => void>()
let snap: ArticleShelf = {
  items: loadShelfItems(),
  loadingUrl: null,
  speakingUrl: null,
}

onProfileDidChange((_prev, nextId) => {
  KEY = articlesKey(nextId)
  DROPPED_KEY = droppedKey(nextId)
  droppedUrls = loadDroppedUrls()
  snap = {
    items: loadShelfItems(),
    loadingUrl: null,
    speakingUrl: null,
  }
  summarizingUrls.clear()
  for (const fn of listeners) fn()
})

const summarizingUrls = new Set<string>()

subscribeTtsActivity(() => {
  if (!snap.speakingUrl) return
  if (isTtsBusy() || isTtsPlaying()) return
  snap = { ...snap, speakingUrl: null }
  emit()
})

function emit(): void {
  saveJson(KEY, snap.items)
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getOpenArticles(): OpenArticle[] {
  return snap.items
}

export function getArticleShelf(): ArticleShelf {
  return snap
}

export function useArticleShelf(): ArticleShelf {
  return useSyncExternalStore(subscribe, getArticleShelf, getArticleShelf)
}

export function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export function sameArticleUrl(a: string, b: string): boolean {
  const ya = youtubeTabId(a)
  const yb = youtubeTabId(b)
  if (ya && yb) return ya === yb
  const ua = parseHttpUrl(a)
  const ub = parseHttpUrl(b)
  if (!ua || !ub) return false
  const host = (h: string) => h.replace(/^www\./i, '').toLowerCase()
  const path = (p: string) => p.replace(/\/+$/, '') || '/'
  return (
    host(ua.hostname) === host(ub.hostname) &&
    path(ua.pathname) === path(ub.pathname)
  )
}

export function articleForUrl(url: string): OpenArticle | undefined {
  return snap.items.find((item) => sameArticleUrl(item.url, url))
}

/** Digest story for this URL, or a stand-in so source-link thumbs can still vote. */
export function itemForSourceUrl(url: string, title?: string): WebItem {
  const briefing = getWebDigest().items.find(
    (row) => row.url && sameArticleUrl(row.url, url),
  )
  if (briefing) return briefing
  const article = articleForUrl(url)
  const label = (title || article?.title || hostLabel(url)).trim()
  const youtube = youtubeTabId(url)
  return {
    id: youtube ? `youtube:${youtube}` : url,
    source: 'topic',
    title: label || hostLabel(url),
    blurb: '',
    url,
  }
}

export function dropArticle(url: string): void {
  const next = snap.items.filter((item) => !sameArticleUrl(item.url, url))
  if (next.length === snap.items.length) return
  const speakingThis =
    Boolean(snap.speakingUrl) && sameArticleUrl(snap.speakingUrl!, url)
  if (speakingThis) stopTts()
  snap = {
    ...snap,
    items: next,
    speakingUrl: speakingThis ? null : snap.speakingUrl,
  }
  emit()
}

function patchOpenArticle(
  url: string,
  patch: Partial<OpenArticle>,
): OpenArticle | undefined {
  const idx = snap.items.findIndex((item) => sameArticleUrl(item.url, url))
  if (idx < 0) return undefined
  const next = { ...snap.items[idx]!, ...patch }
  const items = [...snap.items]
  items[idx] = next
  snap = { ...snap, items }
  emit()
  return next
}

export function setSpeakingArticleUrl(url: string | null): void {
  if (url === snap.speakingUrl) return
  snap = { ...snap, speakingUrl: url }
  emit()
}

async function fillSpokenSummary(
  article: OpenArticle,
  signal?: AbortSignal,
): Promise<void> {
  if (article.spokenSummary?.trim()) return
  if (summarizingUrls.has(article.url)) return
  summarizingUrls.add(article.url)
  try {
    const spokenSummary = await summarizeArticleForSpeech(article, signal)
    if (!spokenSummary) return
    if (!articleForUrl(article.url)) return
    patchOpenArticle(article.url, { spokenSummary })
  } catch {
    // Keep the article; Speak stays hidden until a summary exists.
  } finally {
    summarizingUrls.delete(article.url)
  }
}

export function ensureSpokenSummary(url: string): void {
  const article = articleForUrl(url)
  if (!article?.spokenSummary) {
    if (article) void fillSpokenSummary(article)
  }
}

function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)\]>'"]+/gi)].map((m) => m[0] ?? '')
}

export function briefingItemsForText(text: string): WebItem[] {
  const digest = getWebDigest()
  const hits: WebItem[] = []
  const seen = new Set<string>()
  const push = (item: WebItem) => {
    if (!item.url || seen.has(item.id)) return
    seen.add(item.id)
    hits.push(item)
  }
  for (const url of urlsInText(text)) {
    const item = digest.items.find(
      (row) => row.url && sameArticleUrl(row.url, url),
    )
    if (item) push(item)
  }
  for (const item of digest.items) {
    if (!item.url || !isConversationalItem(item)) continue
    if (itemMentionedInText(text, item)) push(item)
  }
  return hits
}

export function itemsMentionedInSession(
  messages: { role: string; content: string }[],
): WebItem[] {
  const byId = new Map<
    string,
    { item: WebItem; lastAt: number; lastAssistantAt: number }
  >()
  messages.forEach((m, i) => {
    if (m.role !== 'assistant' && m.role !== 'user') return
    for (const item of briefingItemsForText(m.content)) {
      const prev = byId.get(item.id)
      byId.set(item.id, {
        item,
        lastAt: i,
        lastAssistantAt:
          m.role === 'assistant' ? i : (prev?.lastAssistantAt ?? -1),
      })
    }
  })
  return [...byId.values()]
    .sort((a, b) => {
      if (a.lastAssistantAt !== b.lastAssistantAt) {
        return b.lastAssistantAt - a.lastAssistantAt
      }
      return b.lastAt - a.lastAt
    })
    .map((row) => row.item)
}

export async function loadArticle(
  url: string,
  opts?: {
    title?: string
    signal?: AbortSignal
    requireBriefing?: boolean
    waitForSummary?: boolean
    question?: string
    /** User asked to load this page; skip the dropped lock and keep it even if the body is a weak match. */
    force?: boolean
  },
): Promise<OpenArticle> {
  const parsed = parseHttpUrl(url)
  if (!parsed) throw new Error('That is not a valid web address.')
  parsed.hash = ''
  const href = parsed.toString()
  if (!getWebConfig().enabled) {
    throw new Error('Turn on news to load source articles.')
  }
  if (newsAccess(getUserProfile().age) === 'child') {
    throw new Error('Source articles are not loaded for this profile.')
  }
  if (isDroppedSourceUrl(href) && !opts?.force) {
    throw new Error(droppedSourceMessage())
  }
  const briefing = getWebDigest().items.find(
    (item) => item.url && sameArticleUrl(item.url, href),
  )
  if (opts?.requireBriefing && !briefing) {
    throw new Error('Only today’s briefing sources can be loaded automatically.')
  }
  const existing = articleForUrl(href)
  if (existing) {
    const pending = existing.spokenSummary
      ? Promise.resolve()
      : fillSpokenSummary(existing, opts?.signal)
    if (opts?.waitForSummary) await pending
    else void pending
    return articleForUrl(href) ?? existing
  }
  if (snap.loadingUrl && sameArticleUrl(snap.loadingUrl, href)) {
    throw new Error('Already reading that article.')
  }

  snap = { ...snap, loadingUrl: href }
  emit()
  try {
    const youtube = Boolean(youtubeVideoIdFromUrl(href))
    const fetched = youtube
      ? await fetchYoutubeTranscript(href, opts?.signal)
      : await fetchArticleText(href, opts?.signal)
    const kind = youtube ? ('transcript' as const) : undefined
    const title = (opts?.title || briefing?.title || fetched.title).trim()
    const claim: ArticleClaim = {
      title,
      blurb: briefing?.blurb,
      topic: briefing?.topic,
      question: opts?.question?.trim() || undefined,
      kind,
    }
    const relevant = await articleSupportsClaim(
      fetched.body,
      claim,
      opts?.signal,
    )
    if (!relevant && !opts?.force) {
      disqualifySource(briefing?.url ?? href)
      throw new Error(droppedSourceMessage(kind))
    }
    const article: OpenArticle = {
      url: briefing?.url ?? href,
      title,
      host: youtube ? 'YouTube' : hostLabel(href),
      body: fetched.body,
      fetchedAt: new Date().toISOString(),
      ...(kind ? { kind } : {}),
    }
    const rest = snap.items.filter((item) => !sameArticleUrl(item.url, article.url))
    const items = [...rest, article].slice(-MAX_OPEN_ARTICLES)
    const speakingDropped =
      Boolean(snap.speakingUrl) &&
      !items.some((item) => sameArticleUrl(item.url, snap.speakingUrl!))
    if (speakingDropped) stopTts()
    snap = {
      ...snap,
      items,
      loadingUrl: opts?.waitForSummary ? href : null,
      speakingUrl: speakingDropped ? null : snap.speakingUrl,
    }
    emit()
    const pending = fillSpokenSummary(article, opts?.signal)
    if (opts?.waitForSummary) await pending
    else void pending
    if (snap.loadingUrl && sameArticleUrl(snap.loadingUrl, href)) {
      snap = { ...snap, loadingUrl: null }
      emit()
    }
    return articleForUrl(article.url) ?? article
  } catch (e) {
    snap = { ...snap, loadingUrl: null }
    emit()
    throw e
  }
}

function wantsDeeperRead(text: string): boolean {
  return /\b(more|details|read|article|source|deeper|explain|happened|go into|full story|what does it|what did (it|they)|expand|dig)\b/i.test(
    text,
  )
}

export function briefingItemsForTurn(
  userText: string,
  lastAssistant?: string,
): WebItem[] {
  const direct = briefingItemsForText(userText)
  if (direct.length) return direct
  if (!lastAssistant || !wantsDeeperRead(userText)) return []
  const digest = getWebDigest()
  const fromLinks: WebItem[] = []
  const seen = new Set<string>()
  for (const url of parseNewsLinkLines(lastAssistant).urls) {
    const item = digest.items.find(
      (row) => row.url && sameArticleUrl(row.url, url),
    )
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    fromLinks.push(item)
  }
  if (fromLinks.length) return fromLinks.slice(0, 1)
  return briefingItemsForText(lastAssistant).slice(0, 1)
}

export async function loadArticlesForUserText(
  text: string,
  signal?: AbortSignal,
  lastAssistant?: string,
): Promise<OpenArticle[]> {
  if (!getWebConfig().enabled) return []
  if (newsAccess(getUserProfile().age) === 'child') return []
  const wanted = briefingItemsForTurn(text, lastAssistant)
    .filter(
      (item) =>
        item.url && !articleForUrl(item.url) && !isDroppedSourceUrl(item.url),
    )
    .slice(0, 1)
  const loaded: OpenArticle[] = []
  for (const item of wanted) {
    if (!item.url) continue
    if (signal?.aborted) break
    try {
      loaded.push(
        await loadArticle(item.url, {
          title: item.title,
          signal,
          requireBriefing: true,
          question: text,
        }),
      )
    } catch (e) {
      if (signal?.aborted) throw e
      // Keep the headline; the turn still runs.
    }
  }
  return loaded
}
