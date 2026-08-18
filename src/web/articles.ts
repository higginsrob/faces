import { useSyncExternalStore } from 'react'
import { getUserProfile } from '../profile/store'
import { loadJson, saveJson } from '../storage'
import { isConversationalItem, newsAccess } from './age'
import { getWebDigest } from './digest'
import { fetchArticleText } from './fetchers/article'
import { hostLabel, parseNewsLinkLines } from './links'
import { itemMentionedInText } from './matchMention'
import { getWebConfig } from './store'
import type { OpenArticle, WebItem } from './types'

const KEY = 'faces:web-articles'
const MAX_OPEN = 2

export type ArticleShelf = {
  items: OpenArticle[]
  loadingUrl: string | null
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
  return {
    url,
    title,
    host: str(o.host).trim() || hostLabel(url),
    body,
    fetchedAt: str(o.fetchedAt).trim() || new Date().toISOString(),
  }
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
}

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

export function dropArticle(url: string): void {
  const next = snap.items.filter((item) => !sameArticleUrl(item.url, url))
  if (next.length === snap.items.length) return
  snap = { ...snap, items: next }
  emit()
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

export async function loadArticle(
  url: string,
  opts?: { title?: string; signal?: AbortSignal; requireBriefing?: boolean },
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
  const briefing = getWebDigest().items.find(
    (item) => item.url && sameArticleUrl(item.url, href),
  )
  if (opts?.requireBriefing && !briefing) {
    throw new Error('Only today’s briefing sources can be loaded automatically.')
  }
  const existing = articleForUrl(href)
  if (existing) return existing
  if (snap.loadingUrl && sameArticleUrl(snap.loadingUrl, href)) {
    throw new Error('Already reading that article.')
  }

  snap = { ...snap, loadingUrl: href }
  emit()
  try {
    const fetched = await fetchArticleText(href, opts?.signal)
    const article: OpenArticle = {
      url: briefing?.url ?? href,
      title: (opts?.title || briefing?.title || fetched.title).trim(),
      host: hostLabel(href),
      body: fetched.body,
      fetchedAt: new Date().toISOString(),
    }
    const rest = snap.items.filter((item) => !sameArticleUrl(item.url, article.url))
    snap = {
      items: [...rest, article].slice(-MAX_OPEN),
      loadingUrl: null,
    }
    emit()
    return article
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
    .filter((item) => item.url && !articleForUrl(item.url))
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
        }),
      )
    } catch (e) {
      if (signal?.aborted) throw e
      // Keep the headline; the turn still runs.
    }
  }
  return loaded
}
