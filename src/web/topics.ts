import type { UserProfile } from '../profile/types'
import { termsFromText } from './prefs'
import type { WebConfig, WebItem } from './types'

type TopicSense = { include: string[]; exclude: string[] }

const SINGLE_WORD_SENSE: Record<string, TopicSense> = {
  drums: {
    include: ['music', 'percussion', 'drumming', 'drummer'],
    exclude: ['oil', 'barrel', 'crude', 'waste'],
  },
  drum: {
    include: ['music', 'percussion', 'drumming', 'drummer'],
    exclude: ['oil', 'barrel', 'crude'],
  },
}

export function splitTopicHint(raw: string): { term: string; hint: string | null } {
  const t = raw.trim().replace(/\s+/g, ' ')
  const paren = t.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (paren?.[1] && paren[2]) {
    return { term: paren[1].trim(), hint: paren[2].trim() }
  }
  return { term: t, hint: null }
}

function senseFor(raw: string): TopicSense | null {
  const { term, hint } = splitTopicHint(raw)
  if (hint) {
    const include = hint
      .split(/[,/]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
    return include.length ? { include, exclude: [] } : null
  }
  return SINGLE_WORD_SENSE[term.toLowerCase()] ?? null
}

function googleToken(value: string): string {
  const t = value.replace(/"/g, '').trim()
  if (!t) return ''
  return /[^a-zA-Z0-9]/.test(t) ? `"${t}"` : t
}

export function topicSearchQuery(raw: string): string {
  const { term } = splitTopicHint(raw)
  const cleaned = term.replace(/"/g, '').trim()
  if (!cleaned) return ''
  const head = googleToken(cleaned)
  const sense = senseFor(raw)
  if (!sense) return head
  const include = sense.include.slice(0, 2).map(googleToken).filter(Boolean)
  const exclude = sense.exclude
    .slice(0, 3)
    .map((w) => w.replace(/"/g, '').trim())
    .filter(Boolean)
    .map((w) => `-${w}`)
  return [head, ...include, ...exclude].join(' ')
}

export function topicArticleFits(text: string, rawTopic: string): boolean {
  const sense = senseFor(rawTopic)
  if (!sense) return true
  const hay = text.toLowerCase()
  const hitInclude = sense.include.some((w) => hay.includes(w.toLowerCase()))
  const hitExclude = sense.exclude.some((w) => hay.includes(w.toLowerCase()))
  if (hitExclude && !hitInclude) return false
  return true
}

export const MAX_CARE_TOPICS = 8
export const MAX_SKIP_TOPICS = 12

export function parseTopicList(text: string, limit = MAX_CARE_TOPICS): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[,;\n]+/)) {
    const topic = part.trim().replace(/\s+/g, ' ')
    if (topic.length < 2 || topic.length > 48) continue
    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(topic)
    if (out.length >= limit) break
  }
  return out
}

export function cleanTopicList(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return []
  const text = raw.filter((item): item is string => typeof item === 'string').join('\n')
  return parseTopicList(text, limit)
}

export function mergeTopics(existing: string[], added: string[], limit?: number): string[] {
  const seen = new Set(existing.map((t) => t.toLowerCase()))
  const merged = [...existing]
  for (const topic of added) {
    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(topic)
    if (limit != null && merged.length >= limit) break
  }
  return merged
}

export function parseOneTopic(raw: string): string | null {
  return parseTopicList(raw, 1)[0] ?? null
}

/** Copy Profile interests into the explicit care list so the first thumb does not drop them. */
export function seedCareTopicsIfEmpty(
  topics: string[],
  profileInterests: string,
): string[] {
  if (topics.length) return topics
  return parseTopicList(profileInterests)
}

export function topicOnList(list: string[], keyword: string): boolean {
  const key = keyword.trim().toLowerCase()
  if (!key) return false
  return list.some((topic) => topic.toLowerCase() === key)
}

export function suggestStoryKeyword(item: WebItem): string {
  const fromTopic = item.topic?.trim().replace(/\s+/g, ' ') ?? ''
  if (fromTopic.length >= 2 && fromTopic.length <= 48) return fromTopic
  const terms = termsFromText(item.title, 4).slice(0, 2)
  if (terms.length >= 2) {
    const phrase = `${terms[0]} ${terms[1]}`
    if (phrase.length <= 48) return phrase
  }
  return terms[0] ?? ''
}

export function resolveFetchTopics(
  cfg: WebConfig,
  profile: UserProfile,
): string[] {
  if (cfg.topics.length) return cfg.topics.slice(0, MAX_CARE_TOPICS)
  return parseTopicList(profile.interests)
}

export function resolveIgnoreTopics(cfg: WebConfig): string[] {
  return cfg.ignoreTopics.slice(0, MAX_SKIP_TOPICS)
}

export function textHitsTopic(text: string, rawTopic: string): boolean {
  const hay = text.toLowerCase()
  const { term, hint } = splitTopicHint(rawTopic)
  const needle = term.trim().toLowerCase()
  if (needle.length >= 2 && hay.includes(needle)) return true
  if (hint) {
    const h = hint.trim().toLowerCase()
    if (h.length >= 2 && hay.includes(h)) return true
  }
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countTermHits(hay: string, needle: string): number {
  const term = needle.trim()
  if (term.length < 2) return 0
  try {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    return hay.match(re)?.length ?? 0
  } catch {
    const low = hay.toLowerCase()
    const n = term.toLowerCase()
    let count = 0
    let idx = 0
    while ((idx = low.indexOf(n, idx)) !== -1) {
      count += 1
      idx += n.length
    }
    return count
  }
}

/** How strongly an interest tag matches story text. Higher is a closer association. */
export function topicMatchScore(text: string, rawTopic: string): number {
  const hay = text.trim()
  if (!hay) return 0
  const { term, hint } = splitTopicHint(rawTopic)
  const termHits = countTermHits(hay, term)
  let score = 0
  if (termHits > 0) {
    score += termHits * 3 + Math.min(term.trim().length, 24) * 0.25
  }
  if (hint) {
    for (const part of hint.split(/[,/]+/)) {
      const hits = countTermHits(hay, part)
      if (hits) score += hits * 2
    }
  }
  const sense = senseFor(rawTopic)
  if (sense) {
    let includeHits = 0
    let excludeHits = 0
    for (const word of sense.include) includeHits += countTermHits(hay, word)
    for (const word of sense.exclude) excludeHits += countTermHits(hay, word)
    score += includeHits * 2
    score -= excludeHits * 4
    if (excludeHits && !includeHits && !termHits) return 0
  }
  return score
}

export function sameTopicLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function storyHaystack(item: WebItem): string {
  return `${item.title} ${item.blurb}`
}

function scoreTopicForItem(item: WebItem, topic: string): number {
  let score = topicMatchScore(storyHaystack(item), topic)
  if (item.topic && sameTopicLabel(item.topic, topic)) {
    score = score > 0 ? score + 0.5 : 0.1
  }
  return score
}

/** Interest tags that match this story, strongest first. */
export function associatedLabels(item: WebItem, topics: string[]): string[] {
  const ranked = topics
    .map((topic) => ({ topic, score: scoreTopicForItem(item, topic) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
  if (ranked.length) return ranked.map((row) => row.topic)
  const fallback = item.topic?.trim()
  return fallback ? [fallback] : []
}

/** The interest tag most associated with this story, or null if none. */
export function mainInterestLabel(item: WebItem, topics: string[]): string | null {
  return associatedLabels(item, topics)[0] ?? null
}

export function collectStoryLabels(items: WebItem[], topics: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    for (const label of associatedLabels(item, topics)) {
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(label)
    }
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export function itemMatchesLabels(
  item: WebItem,
  topics: string[],
  selected: string[],
): boolean {
  if (!selected.length) return true
  const labels = associatedLabels(item, topics)
  return selected.some((pick) => labels.some((label) => sameTopicLabel(label, pick)))
}

export function textHitsAnyTopic(text: string, topics: string[]): boolean {
  return topics.some((topic) => textHitsTopic(text, topic))
}

export function relevanceTerms(
  profile: UserProfile,
  topics: string[],
): string[] {
  const raw = [
    ...topics,
    profile.location,
    profile.politics,
    profile.religion,
    profile.title,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    for (const part of value.split(/[,;/]+/)) {
      const term = part.trim().toLowerCase()
      if (term.length < 3 || seen.has(term)) continue
      seen.add(term)
      out.push(term)
    }
  }
  return out
}
