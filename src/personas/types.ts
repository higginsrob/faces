import {
  VOICE_ACCENT_OPTIONS,
  VOICE_AGE_OPTIONS,
  VOICE_GENDER_OPTIONS,
  type VoiceAccent,
  type VoiceAge,
  type VoiceGender,
} from '../voice/ttsStore'

export type Persona = {
  id: string
  name: string
  sphereColor: string
  systemPrompt: string
  defaultFace: string
  voiceAge: VoiceAge
  voiceGender: VoiceGender
  voiceAccent: VoiceAccent
}

function voiceEnum<T extends string>(
  value: unknown,
  options: readonly { value: T }[],
  fallback: T,
): T {
  return typeof value === 'string' && options.some((o) => o.value === value)
    ? (value as T)
    : fallback
}

export function normalizePersona(
  raw: Partial<Persona> & Pick<Persona, 'id' | 'name'>,
): Persona {
  return {
    id: raw.id,
    name: raw.name.trim() || 'companion',
    sphereColor:
      typeof raw.sphereColor === 'string' && raw.sphereColor.trim()
        ? raw.sphereColor.trim()
        : '#f5c400',
    systemPrompt:
      typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    defaultFace:
      typeof raw.defaultFace === 'string' && raw.defaultFace.trim()
        ? raw.defaultFace.trim()
        : '😊',
    voiceAge: voiceEnum(raw.voiceAge, VOICE_AGE_OPTIONS, ''),
    voiceGender: voiceEnum(raw.voiceGender, VOICE_GENDER_OPTIONS, ''),
    voiceAccent: voiceEnum(raw.voiceAccent, VOICE_ACCENT_OPTIONS, ''),
  }
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value
}

function withArticle(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`
}

/** Natural-language voice, e.g. "a young woman with an American accent". */
export function describePersonaVoice(persona: Persona): string | null {
  const { voiceAge: age, voiceGender: gender, voiceAccent: accent } = persona
  let noun = ''
  if (age === 'teenager') {
    noun =
      gender === 'female'
        ? 'teenage girl'
        : gender === 'male'
          ? 'teenage boy'
          : 'teenager'
  } else if (age === 'young adult') {
    noun =
      gender === 'female'
        ? 'young woman'
        : gender === 'male'
          ? 'young man'
          : 'young adult'
  } else if (age === 'middle-aged') {
    noun =
      gender === 'female'
        ? 'middle-aged woman'
        : gender === 'male'
          ? 'middle-aged man'
          : 'middle-aged person'
  } else if (age === 'elderly') {
    noun =
      gender === 'female'
        ? 'elderly woman'
        : gender === 'male'
          ? 'elderly man'
          : 'elderly person'
  } else if (gender === 'female') {
    noun = 'woman'
  } else if (gender === 'male') {
    noun = 'man'
  }

  const accentPhrase = accent ? `${capitalize(accent)} accent` : ''
  if (noun && accentPhrase) {
    return `${withArticle(noun)} with ${withArticle(accentPhrase)}`
  }
  if (noun) return withArticle(noun)
  if (accentPhrase) return `someone with ${withArticle(accentPhrase)}`
  return null
}
