import { useSyncExternalStore } from 'react'
import {
  getActiveProfile,
  patchActiveNewsPrefs,
  subscribeProfiles,
} from '../profile/store'
import { loadJson, saveJson } from '../storage'
import { defaultWebSources, type WebConfig, type WebSources } from './types'

const KEY = 'faces:web'

type StoredWeb = {
  enabled: boolean
  jinaApiKey: string
}

export function defaultWebConfig(): WebConfig {
  return {
    enabled: false,
    sources: defaultWebSources(),
    topics: [],
    ignoreTopics: [],
    jinaApiKey: '',
  }
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeStored(raw: Partial<StoredWeb> | null): StoredWeb {
  const d = defaultWebConfig()
  return {
    enabled: bool(raw?.enabled, d.enabled),
    jinaApiKey:
      typeof raw?.jinaApiKey === 'string' ? raw.jinaApiKey.trim() : d.jinaApiKey,
  }
}

function mergeConfig(stored: StoredWeb): WebConfig {
  const profile = getActiveProfile()
  return {
    enabled: stored.enabled,
    jinaApiKey: stored.jinaApiKey,
    sources: profile.sources,
    topics: profile.topics,
    ignoreTopics: profile.ignoreTopics,
  }
}

function sameMerged(a: WebConfig, b: WebConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.jinaApiKey === b.jinaApiKey &&
    a.sources === b.sources &&
    a.topics === b.topics &&
    a.ignoreTopics === b.ignoreTopics
  )
}

const listeners = new Set<() => void>()
let snap = normalizeStored(loadJson<Partial<StoredWeb> | null>(KEY, null))
let merged = mergeConfig(snap)
let mergedProfileId = getActiveProfile().id

function emit(): void {
  saveJson(KEY, snap)
  merged = mergeConfig(snap)
  mergedProfileId = getActiveProfile().id
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

subscribeProfiles(() => {
  const profile = getActiveProfile()
  const next = mergeConfig(snap)
  if (profile.id === mergedProfileId && sameMerged(merged, next)) return
  mergedProfileId = profile.id
  merged = next
  for (const fn of listeners) fn()
})

export function getWebConfig(): WebConfig {
  return merged
}

export function useWebConfig(): WebConfig {
  return useSyncExternalStore(subscribe, getWebConfig, getWebConfig)
}

export function patchWebConfig(patch: Partial<WebConfig>): void {
  let globalChanged = false
  if (patch.enabled !== undefined || patch.jinaApiKey !== undefined) {
    snap = normalizeStored({
      enabled: patch.enabled ?? snap.enabled,
      jinaApiKey: patch.jinaApiKey ?? snap.jinaApiKey,
    })
    globalChanged = true
  }
  if (
    patch.sources !== undefined ||
    patch.topics !== undefined ||
    patch.ignoreTopics !== undefined
  ) {
    patchActiveNewsPrefs({
      sources: patch.sources,
      topics: patch.topics,
      ignoreTopics: patch.ignoreTopics,
    })
  }
  if (globalChanged) emit()
}

export function patchWebSources(patch: Partial<WebSources>): void {
  patchWebConfig({ sources: { ...getWebConfig().sources, ...patch } })
}
