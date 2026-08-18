import type { UserProfile } from '../profile/types'
import type { WebConfig } from './types'

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

export function parseTopicList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[,;\n]+/)) {
    const topic = part.trim().replace(/\s+/g, ' ')
    if (topic.length < 2 || topic.length > 48) continue
    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(topic)
    if (out.length >= 8) break
  }
  return out
}

export function resolveFetchTopics(
  cfg: WebConfig,
  profile: UserProfile,
): string[] {
  if (cfg.topics.length) return cfg.topics.slice(0, 8)
  return parseTopicList(profile.interests)
}

export function resolveIgnoreTopics(cfg: WebConfig): string[] {
  return cfg.ignoreTopics.slice(0, 12)
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
