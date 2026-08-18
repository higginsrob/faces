import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'
import { defaultOllamaConfig, normalizeOllamaConfig } from './defaults'
import type { OllamaConfig, OllamaOptions } from './types'

const KEY = 'faces:ollama'
const listeners = new Set<() => void>()

let snap: OllamaConfig = normalizeOllamaConfig(
  loadJson<Partial<OllamaConfig> | null>(KEY, null),
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

export function getOllamaConfig(): OllamaConfig {
  return snap
}

export function useOllamaConfig(): OllamaConfig {
  return useSyncExternalStore(subscribe, getOllamaConfig, getOllamaConfig)
}

export function patchOllamaConfig(patch: Partial<OllamaConfig>): void {
  snap = normalizeOllamaConfig({ ...snap, ...patch })
  emit()
}

export function patchOllamaOptions(patch: Partial<OllamaOptions>): void {
  snap = normalizeOllamaConfig({
    ...snap,
    options: { ...snap.options, ...patch },
  })
  emit()
}

export function resetOllamaOptions(): void {
  const d = defaultOllamaConfig()
  snap = normalizeOllamaConfig({
    ...snap,
    keep_alive: d.keep_alive,
    think: d.think,
    options: d.options,
  })
  emit()
}
