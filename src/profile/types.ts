import { defaultWebSources, type WebSources } from '../web/types'

export const EDUCATION_LEVELS = [
  'High school',
  'Trade / vocational',
  'Some college',
  "Bachelor's",
  "Master's",
  'Doctorate',
  'Other',
] as const

export type EducationLevel = (typeof EDUCATION_LEVELS)[number]

export const TALK_STYLES = [
  { value: 'casual', label: 'Casual' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'roast', label: 'Roast me' },
] as const

export type TalkStyle = (typeof TALK_STYLES)[number]['value']

export type UserProfile = {
  name: string
  mood: string
  age: string
  gender: string
  accent: string
  location: string
  title: string
  education: string
  household: string
  religion: string
  politics: string
  talkStyle: string
  interests: string
}

export type ProfileRecord = {
  id: string
  label: string
  user: UserProfile
  sources: WebSources
  topics: string[]
  ignoreTopics: string[]
}

export function emptyUserProfile(): UserProfile {
  return {
    name: '',
    mood: '',
    age: '',
    gender: '',
    accent: '',
    location: '',
    title: '',
    education: '',
    household: '',
    religion: '',
    politics: '',
    talkStyle: '',
    interests: '',
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeUserProfile(
  raw: Partial<UserProfile> | null | undefined,
): UserProfile {
  const base = emptyUserProfile()
  if (!raw || typeof raw !== 'object') return base
  return {
    name: str(raw.name),
    mood: str(raw.mood),
    age: str(raw.age),
    gender: str(raw.gender),
    accent: str(raw.accent),
    location: str(raw.location),
    title: str(raw.title),
    education: str(raw.education),
    household: str(raw.household),
    religion: str(raw.religion),
    politics: str(raw.politics),
    talkStyle: str(raw.talkStyle),
    interests: str(raw.interests),
  }
}

/** Whole years if the age field is a simple number like "8" or "8 years". */
export function parseAgeYears(age: string): number | null {
  const m = age.trim().match(/^(\d{1,3})\s*(?:years?|yrs?|yo)?\.?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0 || n > 120) return null
  return n
}

export function profileHasAny(profile: UserProfile): boolean {
  return Object.values(profile).some((v) => v.trim())
}

export function profileDisplayLabel(profile: {
  label: string
  user: { name: string }
}): string {
  return profile.label.trim() || profile.user.name.trim() || 'Profile'
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeWebSources(raw: unknown): WebSources {
  const d = defaultWebSources()
  if (!raw || typeof raw !== 'object') return d
  const sources = raw as Partial<WebSources>
  return {
    clock: bool(sources.clock, d.clock),
    weather: bool(sources.weather, d.weather),
    nationalNews: bool(sources.nationalNews, d.nationalNews),
    localNews: bool(sources.localNews, d.localNews),
  }
}

export function normalizeTopicList(raw: unknown): string[] {
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
