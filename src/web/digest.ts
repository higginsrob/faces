import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'
import type { WebDigest, WebItem } from './types'

const KEY = 'faces:web-digest'

export function emptyWebDigest(): WebDigest {
  return {
    date: '',
    fetchedAt: '',
    fingerprint: '',
    items: [],
    mentionedIds: [],
    status: 'idle',
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeItem(raw: unknown): WebItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<WebItem>
  const source = o.source
  if (
    source !== 'weather' &&
    source !== 'national' &&
    source !== 'local' &&
    source !== 'topic'
  ) {
    return null
  }
  const id = str(o.id).trim()
  const title = str(o.title).trim()
  const blurb = str(o.blurb).trim()
  if (!id || !title) return null
  const item: WebItem = { id, source, title, blurb }
  const topic = str(o.topic).trim()
  if (topic) item.topic = topic
  const url = str(o.url).trim()
  if (url) item.url = url
  const publishedAt = str(o.publishedAt).trim()
  if (publishedAt) item.publishedAt = publishedAt
  if (typeof o.score === 'number' && Number.isFinite(o.score)) item.score = o.score
  if (typeof o.llmScore === 'number' && Number.isFinite(o.llmScore)) {
    item.llmScore = o.llmScore
  }
  return item
}

export function normalizeWebDigest(raw: Partial<WebDigest> | null): WebDigest {
  const d = emptyWebDigest()
  if (!raw || typeof raw !== 'object') return d
  const status =
    raw.status === 'fetching' || raw.status === 'error' || raw.status === 'idle'
      ? raw.status
      : d.status
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter((x): x is WebItem => x !== null)
    : []
  const mentionedIds = Array.isArray(raw.mentionedIds)
    ? raw.mentionedIds.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      )
    : []
  return {
    date: str(raw.date),
    fetchedAt: str(raw.fetchedAt),
    fingerprint: str(raw.fingerprint),
    items,
    mentionedIds,
    status: status === 'fetching' ? 'idle' : status,
    error: str(raw.error) || undefined,
  }
}

const listeners = new Set<() => void>()
let snap = normalizeWebDigest(loadJson<Partial<WebDigest> | null>(KEY, null))

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

export function getWebDigest(): WebDigest {
  return snap
}

export function useWebDigest(): WebDigest {
  return useSyncExternalStore(subscribe, getWebDigest, getWebDigest)
}

export function setWebDigest(next: WebDigest): void {
  snap = next
  emit()
}

export function patchWebDigest(patch: Partial<WebDigest>): void {
  snap = normalizeWebDigest({ ...snap, ...patch })
  emit()
}

export function addMentionedIds(ids: string[]): void {
  if (!ids.length) return
  const seen = new Set(snap.mentionedIds)
  let changed = false
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    changed = true
  }
  if (!changed) return
  snap = { ...snap, mentionedIds: [...seen] }
  emit()
}

export function toggleMentionedId(id: string): void {
  const has = snap.mentionedIds.includes(id)
  snap = {
    ...snap,
    mentionedIds: has
      ? snap.mentionedIds.filter((x) => x !== id)
      : [...snap.mentionedIds, id],
  }
  emit()
}

export function localDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
