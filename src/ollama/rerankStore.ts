import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'
import { normalizeKeepAlive } from './defaults'
import type { RerankConfig } from './types'

const KEY = 'faces:rerank'
const listeners = new Set<() => void>()

export function defaultRerankConfig(): RerankConfig {
  return {
    model: '',
    keep_alive: '5m',
  }
}

export function normalizeRerankConfig(
  raw: Partial<RerankConfig> | null | undefined,
): RerankConfig {
  const d = defaultRerankConfig()
  return {
    model: typeof raw?.model === 'string' ? raw.model.trim() : '',
    keep_alive: normalizeKeepAlive(raw?.keep_alive, d.keep_alive),
  }
}

let snap: RerankConfig = normalizeRerankConfig(
  loadJson<Partial<RerankConfig> | null>(KEY, null),
)

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

export function getRerankConfig(): RerankConfig {
  return snap
}

export function useRerankConfig(): RerankConfig {
  return useSyncExternalStore(subscribe, getRerankConfig, getRerankConfig)
}

export function patchRerankConfig(patch: Partial<RerankConfig>): void {
  snap = normalizeRerankConfig({ ...snap, ...patch })
  emit()
}
