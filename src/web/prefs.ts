import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'
import type { WebItem } from './types'

const KEY = 'faces:news-prefs'
const MAX_VOTES = 200

export type NewsVote = {
  id: string
  url?: string
  title: string
  vote: 1 | -1
  at: string
}

export type NewsPrefs = {
  votes: NewsVote[]
}

export function emptyNewsPrefs(): NewsPrefs {
  return { votes: [] }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeVote(raw: unknown): NewsVote | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<NewsVote>
  const id = str(o.id).trim()
  const title = str(o.title).trim()
  const vote = o.vote === 1 || o.vote === -1 ? o.vote : 0
  if (!id || !title || !vote) return null
  const item: NewsVote = {
    id,
    title,
    vote,
    at: str(o.at) || new Date().toISOString(),
  }
  const url = str(o.url).trim()
  if (url) item.url = url
  return item
}

export function normalizeNewsPrefs(raw: Partial<NewsPrefs> | null): NewsPrefs {
  if (!raw || typeof raw !== 'object') return emptyNewsPrefs()
  const votes = Array.isArray(raw.votes)
    ? raw.votes.map(normalizeVote).filter((v): v is NewsVote => v !== null)
    : []
  return { votes: votes.slice(-MAX_VOTES) }
}

const listeners = new Set<() => void>()
let snap = normalizeNewsPrefs(loadJson<Partial<NewsPrefs> | null>(KEY, null))

function emit(): void {
  saveJson(KEY, snap)
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getNewsPrefs(): NewsPrefs {
  return snap
}

export function useNewsPrefs(): NewsPrefs {
  return useSyncExternalStore(subscribe, getNewsPrefs, getNewsPrefs)
}

function sameStory(vote: NewsVote, item: WebItem): boolean {
  if (vote.id === item.id) return true
  return Boolean(item.url && vote.url && vote.url === item.url)
}

export function voteForItem(item: WebItem, prefs = snap): 1 | -1 | 0 {
  const found = prefs.votes.find((vote) => sameStory(vote, item))
  return found?.vote ?? 0
}

export function likedTerms(prefs = snap): string[] {
  return termsFromVotes(prefs.votes.filter((v) => v.vote === 1))
}

export function dislikedTerms(prefs = snap): string[] {
  return termsFromVotes(prefs.votes.filter((v) => v.vote === -1))
}

const STOP = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'were',
  'been',
  'they',
  'their',
  'about',
  'after',
  'before',
  'could',
  'would',
  'should',
  'there',
  'where',
  'which',
  'while',
  'into',
  'over',
  'under',
  'than',
  'then',
  'them',
  'your',
  'what',
  'when',
  'will',
  'just',
  'more',
  'some',
  'also',
  'said',
  'says',
  'year',
  'years',
  'news',
  'after',
])

export function termsFromText(text: string, min = 3): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const term = part.trim()
    if (term.length < min || STOP.has(term) || seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}

function termsFromVotes(votes: NewsVote[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const vote of votes) {
    for (const term of termsFromText(vote.title, 4)) {
      if (seen.has(term)) continue
      seen.add(term)
      out.push(term)
    }
  }
  return out
}

/** Set or clear a thumbs vote. Clicking the same vote again clears it. */
export function setNewsVote(item: WebItem, vote: 1 | -1): 1 | -1 | 0 {
  const current = voteForItem(item)
  const nextVote = current === vote ? 0 : vote
  const rest = snap.votes.filter((v) => !sameStory(v, item))
  if (nextVote === 0) {
    snap = { votes: rest.slice(-MAX_VOTES) }
    emit()
    return 0
  }
  const entry: NewsVote = {
    id: item.id,
    title: item.title,
    vote: nextVote,
    at: new Date().toISOString(),
  }
  if (item.url) entry.url = item.url
  snap = { votes: [...rest, entry].slice(-MAX_VOTES) }
  emit()
  return nextVote
}
