import { completeOllamaChat } from '../ollama/client'
import { getRerankConfig } from '../ollama/rerankStore'
import { getUserProfile } from '../profile/store'
import type { UserProfile } from '../profile/types'
import { isConversationalItem } from './age'
import { getWebDigest, setWebDigest } from './digest'
import {
  dislikedTerms,
  getNewsPrefs,
  likedTerms,
  setNewsVote,
  termsFromText,
  voteForItem,
  type NewsPrefs,
} from './prefs'
import { getWebConfig } from './store'
import { resolveFetchTopics, resolveIgnoreTopics } from './topics'
import type { WebItem } from './types'

const LLM_BATCH = 50
const LLM_WEIGHT = 8
const UP_BONUS = 50
const DOWN_PENALTY = 50
const MAX_AGE_DAYS = 14

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function overlap(hay: string, terms: string[]): number {
  if (!terms.length) return 0
  const text = hay.toLowerCase()
  let n = 0
  for (const term of terms) {
    if (term.length >= 3 && text.includes(term)) n += 1
  }
  return n
}

function recencyNudge(publishedAt?: string): number {
  if (!publishedAt) return 0
  const ms = Date.parse(publishedAt)
  if (!Number.isFinite(ms)) return 0
  const days = (Date.now() - ms) / (24 * 60 * 60 * 1000)
  if (days < -1 || days > MAX_AGE_DAYS) return 0
  return 0.35 * Math.max(0, 1 - Math.max(0, days) / MAX_AGE_DAYS)
}

function positiveTerms(
  profile: UserProfile,
  topics: string[],
  prefs: NewsPrefs,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (term: string) => {
    const t = term.trim().toLowerCase()
    if (t.length < 3 || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  for (const raw of [
    profile.interests,
    profile.title,
    profile.location,
    profile.politics,
    profile.religion,
    ...topics,
  ]) {
    for (const part of raw.split(/[,;/]+/)) {
      const chunk = part.trim()
      if (!chunk) continue
      if (chunk.length <= 24 && !/\s/.test(chunk)) push(chunk)
      else for (const term of termsFromText(chunk)) push(term)
    }
  }
  for (const term of likedTerms(prefs)) push(term)
  return out
}

function ignoreTerms(topics: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of topics) {
    for (const part of raw.split(/[,;/]+/)) {
      const chunk = part.trim().toLowerCase()
      if (!chunk) continue
      if (chunk.length <= 24 && !/\s/.test(chunk)) {
        if (chunk.length >= 3 && !seen.has(chunk)) {
          seen.add(chunk)
          out.push(chunk)
        }
        continue
      }
      for (const term of termsFromText(chunk)) {
        if (seen.has(term)) continue
        seen.add(term)
        out.push(term)
      }
    }
  }
  return out
}

function heuristicScore(
  item: WebItem,
  profile: UserProfile,
  topics: string[],
  skipTopics: string[],
  prefs: NewsPrefs,
): number {
  const hay = `${item.title} ${item.blurb} ${item.topic ?? ''}`
  const pos = overlap(hay, positiveTerms(profile, topics, prefs))
  const neg = overlap(hay, dislikedTerms(prefs)) * 1.5
  const skip = overlap(hay, ignoreTerms(skipTopics)) * 2.5
  return pos - neg - skip + recencyNudge(item.publishedAt)
}

function sortByScore(items: WebItem[]): WebItem[] {
  return [...items].sort((a, b) => {
    const aw = a.source === 'weather' ? 0 : 1
    const bw = b.source === 'weather' ? 0 : 1
    if (aw !== bw) return aw - bw
    return (b.score ?? 0) - (a.score ?? 0)
  })
}

export function applyLocalScores(items: WebItem[]): WebItem[] {
  const profile = getUserProfile()
  const prefs = getNewsPrefs()
  const cfg = getWebConfig()
  const topics = resolveFetchTopics(cfg, profile)
  const skipTopics = resolveIgnoreTopics(cfg)
  const scored = items.map((item) => {
    if (!isConversationalItem(item)) {
      const next = { ...item }
      delete next.score
      delete next.llmScore
      return next
    }
    const vote = voteForItem(item, prefs)
    const h = heuristicScore(item, profile, topics, skipTopics, prefs)
    const llm = typeof item.llmScore === 'number' ? item.llmScore : 0
    let score = h + llm * LLM_WEIGHT
    if (vote === 1) score += UP_BONUS
    if (vote === -1) score -= DOWN_PENALTY
    return { ...item, score }
  })
  return sortByScore(scored)
}

export function refreshLocalScores(): void {
  const digest = getWebDigest()
  if (!digest.items.length) return
  setWebDigest({
    ...digest,
    items: applyLocalScores(digest.items),
  })
}

function readerCard(
  profile: UserProfile,
  topics: string[],
  skipTopics: string[],
  prefs: NewsPrefs,
): string {
  const liked = prefs.votes
    .filter((v) => v.vote === 1)
    .slice(-8)
    .map((v) => v.title)
  const disliked = prefs.votes
    .filter((v) => v.vote === -1)
    .slice(-8)
    .map((v) => v.title)
  return [
    profile.title.trim() && `Role: ${profile.title.trim()}`,
    profile.location.trim() && `Location: ${profile.location.trim()}`,
    profile.interests.trim() && `Interests: ${profile.interests.trim()}`,
    topics.length ? `Topics: ${topics.join(', ')}` : '',
    skipTopics.length ? `Avoid topics: ${skipTopics.join(', ')}` : '',
    profile.politics.trim() && `Politics: ${profile.politics.trim()}`,
    profile.religion.trim() && `Religion: ${profile.religion.trim()}`,
    liked.length ? `Liked stories: ${liked.join('; ')}` : '',
    disliked.length ? `Skipped stories: ${disliked.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function llmScores(
  items: WebItem[],
  profile: UserProfile,
  topics: string[],
  skipTopics: string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const cfg = getRerankConfig()
  const scores = new Map<string, number>()
  if (!cfg.model) return scores
  const conversational = items.filter(isConversationalItem)
  if (!conversational.length) return scores
  const prefs = getNewsPrefs()
  const reader =
    readerCard(profile, topics, skipTopics, prefs) || 'No profile details.'

  for (let i = 0; i < conversational.length; i += LLM_BATCH) {
    const batch = conversational.slice(i, i + LLM_BATCH)
    const payload = batch.map((item) => ({
      id: item.id,
      title: item.title,
      blurb: item.blurb.slice(0, 180),
      source: item.source,
      topic: item.topic,
    }))
    try {
      const raw = await completeOllamaChat({
        messages: [
          {
            role: 'system',
            content:
              'You rank news for one reader. Return JSON only. No markdown.',
          },
          {
            role: 'user',
            content: `Reader:\n${reader}

Score 0 to 1 how much this reader would want each story. Score Avoid topics near 0. Keep every id. Return JSON: [{"id":"...","score":0.0}]

${JSON.stringify(payload)}`,
          },
        ],
        signal,
        model: cfg.model,
        keepAlive: cfg.keep_alive,
        temperature: 0,
        numPredict: 2500,
      })
      const parsed = extractJsonArray(raw)
      if (!parsed?.length) continue
      for (const row of parsed) {
        if (!row || typeof row !== 'object') continue
        const o = row as { id?: unknown; score?: unknown }
        if (typeof o.id !== 'string') continue
        const n = typeof o.score === 'number' ? o.score : Number(o.score)
        if (!Number.isFinite(n)) continue
        scores.set(o.id, Math.min(1, Math.max(0, n)))
      }
    } catch {
      // keep heuristic scores for this batch
    }
  }
  return scores
}

export async function rankDigestItems(
  items: WebItem[],
  signal?: AbortSignal,
): Promise<WebItem[]> {
  const profile = getUserProfile()
  const cfg = getWebConfig()
  const topics = resolveFetchTopics(cfg, profile)
  const skipTopics = resolveIgnoreTopics(cfg)
  const llm = await llmScores(items, profile, topics, skipTopics, signal)
  const withLlm = items.map((item) => {
    const score = llm.get(item.id)
    if (score == null) {
      if (item.llmScore == null) return item
      const next = { ...item }
      delete next.llmScore
      return next
    }
    return { ...item, llmScore: score }
  })
  return applyLocalScores(withLlm)
}

export function voteOnStory(item: WebItem, vote: 1 | -1): void {
  setNewsVote(item, vote)
  const digest = getWebDigest()
  setWebDigest({
    ...digest,
    items: applyLocalScores(digest.items),
  })
}

export function forYouStories(
  items: WebItem[],
  mentioned: Set<string>,
): WebItem[] {
  const prefs = getNewsPrefs()
  const stories = items.filter(isConversationalItem)
  return [...stories].sort((a, b) => {
    const ad = voteForItem(a, prefs) === -1 ? 1 : 0
    const bd = voteForItem(b, prefs) === -1 ? 1 : 0
    if (ad !== bd) return ad - bd
    const am = mentioned.has(a.id) ? 1 : 0
    const bm = mentioned.has(b.id) ? 1 : 0
    if (am !== bm) return am - bm
    return (b.score ?? 0) - (a.score ?? 0)
  })
}
