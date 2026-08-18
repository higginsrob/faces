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
