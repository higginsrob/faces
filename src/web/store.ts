import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'
import type { WebConfig, WebSources } from './types'

const KEY = 'faces:web'

export function defaultWebConfig(): WebConfig {
  return {
    enabled: false,
    sources: {
      clock: true,
      weather: true,
      nationalNews: true,
      localNews: true,
    },
    topics: [],
    ignoreTopics: [],
    jinaApiKey: '',
  }
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const topic = item.trim().replace(/\s+/g, ' ')
    if (topic.length < 2 || topic.length > 48) continue
    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(topic)
    if (out.length >= 12) break
  }
  return out
}

export function normalizeWebConfig(raw: Partial<WebConfig> | null): WebConfig {
  const d = defaultWebConfig()
  const sources = raw?.sources
  return {
    enabled: bool(raw?.enabled, d.enabled),
    sources: {
      clock: bool(sources?.clock, d.sources.clock),
      weather: bool(sources?.weather, d.sources.weather),
      nationalNews: bool(sources?.nationalNews, d.sources.nationalNews),
      localNews: bool(sources?.localNews, d.sources.localNews),
    },
    topics: normalizeTopics(raw?.topics),
    ignoreTopics: normalizeTopics(raw?.ignoreTopics),
    jinaApiKey:
      typeof raw?.jinaApiKey === 'string' ? raw.jinaApiKey.trim() : d.jinaApiKey,
  }
}

const listeners = new Set<() => void>()
let snap = normalizeWebConfig(loadJson<Partial<WebConfig> | null>(KEY, null))

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

export function getWebConfig(): WebConfig {
  return snap
}

export function useWebConfig(): WebConfig {
  return useSyncExternalStore(subscribe, getWebConfig, getWebConfig)
}

export function patchWebConfig(patch: Partial<WebConfig>): void {
  snap = normalizeWebConfig({
    ...snap,
    ...patch,
    sources: { ...snap.sources, ...patch.sources },
    topics: patch.topics ?? snap.topics,
    ignoreTopics: patch.ignoreTopics ?? snap.ignoreTopics,
  })
  emit()
}

export function patchWebSources(patch: Partial<WebSources>): void {
  patchWebConfig({ sources: { ...snap.sources, ...patch } })
}
