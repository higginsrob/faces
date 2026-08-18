import {
  getActiveProfile,
  getActiveProfileId,
  getUserProfile,
  onProfileDidChange,
  onProfileWillChange,
} from '../profile/store'
import { filterItemsForAge, isConversationalItem, newsAccess } from './age'
import {
  getWebDigest,
  localDateKey,
  patchWebDigest,
  setWebDigest,
} from './digest'
import { webFingerprint } from './fingerprint'
import { fetchWeatherItem } from './fetchers/weather'
import {
  fetchLocalNews,
  fetchNationalNews,
  fetchTopicsNews,
} from './fetchers/recentNews'
import { applyLocalScores, rankDigestItems } from './rerank'
import { getWebConfig } from './store'
import { summarizeDigestItems } from './summarize'
import { relevanceTerms, resolveFetchTopics } from './topics'
import type { WebItem } from './types'

let inflight: Promise<void> | null = null
let abort: AbortController | null = null

function clearFetchingIfNeeded(): void {
  if (getWebDigest().status !== 'fetching') return
  patchWebDigest({ status: 'idle' })
}

onProfileWillChange(() => {
  abort?.abort()
  abort = null
  inflight = null
  clearFetchingIfNeeded()
})

onProfileDidChange(() => {
  void ensureWebDigest()
})

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

export async function ensureWebDigest(opts?: { force?: boolean }): Promise<void> {
  const cfg = getWebConfig()
  if (!cfg.enabled) return
  const profileId = getActiveProfileId()
  const profile = getUserProfile()
  const fingerprint = webFingerprint(cfg, profile, profileId)
  const today = localDateKey()
  const current = getWebDigest()
  if (
    !opts?.force &&
    current.date === today &&
    current.fingerprint === fingerprint &&
    current.status !== 'error' &&
    current.status !== 'fetching'
  ) {
    return
  }
  if (!opts?.force && inflight) return inflight
  const p = runFetch(opts?.force === true, profileId).finally(() => {
    if (inflight === p) inflight = null
  })
  inflight = p
  return p
}

function stillThisProfile(profileId: string, signal: AbortSignal): boolean {
  return !signal.aborted && getActiveProfileId() === profileId
}

async function runFetch(force: boolean, profileId: string): Promise<void> {
  abort?.abort()
  abort = new AbortController()
  const signal = abort.signal
  const active = getActiveProfile()
  const cfg = {
    ...getWebConfig(),
    sources: active.sources,
    topics: active.topics,
    ignoreTopics: active.ignoreTopics,
  }
  const profile = active.user
  const fingerprint = webFingerprint(cfg, profile, profileId)
  const today = localDateKey()
  const previous = getWebDigest()
  const access = newsAccess(profile.age)
  const topics = resolveFetchTopics(cfg, profile)
  const terms = relevanceTerms(profile, topics)
  const location = profile.location.trim()

  if (!stillThisProfile(profileId, signal)) return

  setWebDigest({
    ...previous,
    status: 'fetching',
    error: undefined,
  })

  const items: WebItem[] = []
  const errors: string[] = []

  const push = async (
    label: string,
    task: () => Promise<WebItem | WebItem[]>,
  ) => {
    try {
      const result = await task()
      if (!stillThisProfile(profileId, signal)) return
      if (Array.isArray(result)) items.push(...result)
      else items.push(result)
    } catch (e) {
      if (!stillThisProfile(profileId, signal) || isAbortError(e)) return
      errors.push(
        `${label}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const jobs: Promise<void>[] = []
  if (cfg.sources.weather) {
    if (location) {
      jobs.push(push('Weather', () => fetchWeatherItem(location, signal)))
    } else {
        errors.push('Weather: add a location in this profile.')
    }
  }

  if (access !== 'child') {
    if (cfg.sources.nationalNews) {
      jobs.push(push('National news', () => fetchNationalNews(terms, signal)))
    }
    if (cfg.sources.localNews) {
      if (location) {
        jobs.push(
          push('Local news', () => fetchLocalNews(location, terms, signal)),
        )
      } else {
        errors.push('Local news: add a location in this profile.')
      }
    }
    if (topics.length) {
      jobs.push(push('Topics', () => fetchTopicsNews(topics, signal)))
    }
  }

  await Promise.all(jobs)
  if (!stillThisProfile(profileId, signal)) return

  const nextItems = await rankDigestItems(
    filterItemsForAge(dedupe(items), profile.age),
    signal,
  )
  if (!stillThisProfile(profileId, signal)) return
  const mentionedIds =
    !force && previous.date === today
      ? previous.mentionedIds.filter((id) => nextItems.some((i) => i.id === id))
      : []
  const failed = nextItems.length === 0 && errors.length > 0
  const snapshot = {
    date: today,
    fetchedAt: new Date().toISOString(),
    fingerprint,
    items: nextItems,
    mentionedIds,
    status: failed ? ('error' as const) : ('idle' as const),
    error: errors.length ? errors.join(' ') : undefined,
  }
  setWebDigest(snapshot)
  if (failed || !nextItems.some(isConversationalItem)) return

  const summarized = await summarizeDigestItems(
    nextItems,
    profile.age,
    signal,
  )
  if (!stillThisProfile(profileId, signal)) return
  const current = getWebDigest()
  if (current.fingerprint !== fingerprint) return
  setWebDigest({
    ...current,
    items: applyLocalScores(summarized),
    mentionedIds: current.mentionedIds.filter((id) =>
      summarized.some((item) => item.id === id),
    ),
  })
}

function dedupe(items: WebItem[]): WebItem[] {
  const seen = new Set<string>()
  const out: WebItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}
