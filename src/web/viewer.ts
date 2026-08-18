import { useSyncExternalStore } from 'react'
import { parseHttpUrl, sameArticleUrl } from './articles'

export type SourceEmbed = 'pending' | 'ok' | 'blocked'

export type SourceTab = {
  id: string
  url: string
  title: string
  embed: SourceEmbed
}

export type SourceViewer = {
  tabs: SourceTab[]
  activeId: string | null
}

const listeners = new Set<() => void>()
const unframeableHosts = new Set<string>()
let snap: SourceViewer = { tabs: [], activeId: null }

function hostKey(url: string): string {
  const parsed = parseHttpUrl(url)
  if (!parsed) return ''
  return parsed.hostname.replace(/^www\./i, '').toLowerCase()
}

function emit(): void {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function tabId(url: string): string {
  const parsed = parseHttpUrl(url)
  if (!parsed) return url
  parsed.hash = ''
  return parsed.toString()
}

export function getSourceViewer(): SourceViewer {
  return snap
}

export function useSourceViewer(): SourceViewer {
  return useSyncExternalStore(subscribe, getSourceViewer, getSourceViewer)
}

export function sourceHostUnframeable(url: string): boolean {
  const host = hostKey(url)
  return Boolean(host && unframeableHosts.has(host))
}

export function markSourceUnframeable(url: string): void {
  const host = hostKey(url)
  if (host) unframeableHosts.add(host)
}

/** True when the frame never got a real document (X-Frame-Options, CSP, mixed content). */
export function sourceFrameBlocked(iframe: HTMLIFrameElement): boolean {
  try {
    const href = iframe.contentWindow?.location.href ?? ''
    if (!href || href === 'about:blank') return true
    return /^(about:|chrome:|chrome-error:|edge:|edge-error:|moz-extension:)/i.test(
      href,
    )
  } catch {
    // SecurityError means a cross-origin document loaded — embedding worked.
    return false
  }
}

export function openSourceViewer(next: { url: string; title: string }): void {
  const url = next.url.trim()
  if (!url) return
  const title = next.title.trim() || url
  const id = tabId(url)
  const existing = snap.tabs.find(
    (tab) => tab.id === id || sameArticleUrl(tab.url, url),
  )
  if (existing) {
    snap = {
      tabs: snap.tabs.map((tab) =>
        tab.id === existing.id ? { ...tab, title: title || tab.title } : tab,
      ),
      activeId: existing.id,
    }
    emit()
    return
  }
  const tab: SourceTab = { id, url, title, embed: 'pending' }
  snap = { tabs: [...snap.tabs, tab], activeId: id }
  emit()
}

export function confirmSourceEmbed(id: string): void {
  const tab = snap.tabs.find((item) => item.id === id)
  if (!tab || tab.embed !== 'pending') return
  snap = {
    ...snap,
    tabs: snap.tabs.map((item) =>
      item.id === id ? { ...item, embed: 'ok' } : item,
    ),
  }
  emit()
}

export function failSourceEmbed(id: string): void {
  const tab = snap.tabs.find((item) => item.id === id)
  if (!tab || tab.embed !== 'pending') return
  markSourceUnframeable(tab.url)
  snap = {
    ...snap,
    tabs: snap.tabs.map((item) =>
      item.id === id ? { ...item, embed: 'blocked' } : item,
    ),
  }
  emit()
}

export function selectSourceTab(id: string): void {
  if (!snap.tabs.some((tab) => tab.id === id) || snap.activeId === id) return
  snap = { ...snap, activeId: id }
  emit()
}

export function closeSourceTab(id: string): boolean {
  const i = snap.tabs.findIndex((tab) => tab.id === id)
  if (i < 0) return false
  const tabs = snap.tabs.filter((tab) => tab.id !== id)
  if (!tabs.length) {
    snap = { tabs: [], activeId: null }
    emit()
    return true
  }
  const activeId =
    snap.activeId === id
      ? (tabs[i] ?? tabs[i - 1] ?? tabs[0])!.id
      : snap.activeId
  snap = { tabs, activeId }
  emit()
  return true
}

export function closeSourceViewer(): boolean {
  if (!snap.tabs.length) return false
  snap = { tabs: [], activeId: null }
  emit()
  return true
}
