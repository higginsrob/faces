import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'

export type TtsEngine = 'browser' | 'omnivoice'

export type VoiceAge =
  | ''
  | 'teenager'
  | 'young adult'
  | 'middle-aged'
  | 'elderly'

export type VoiceGender = '' | 'male' | 'female'

export type VoiceAccent =
  | ''
  | 'american'
  | 'british'
  | 'australian'
  | 'canadian'
  | 'indian'
  | 'chinese'
  | 'korean'
  | 'japanese'

export type VoiceDesign = {
  voiceAge: VoiceAge
  voiceGender: VoiceGender
  voiceAccent: VoiceAccent
}

export type TtsConfig = {
  enabled: boolean
  engine: TtsEngine
  browserVoiceURI: string | null
  omniHost: string
  omniVoice: string
  omniModel: string
} & VoiceDesign

const KEY = 'faces:tts'
const DEFAULT_OMNI_HOST = 'http://127.0.0.1:8880'

export const VOICE_AGE_OPTIONS: { value: VoiceAge; label: string }[] = [
  { value: '', label: 'Preset default' },
  { value: 'teenager', label: 'Teenager' },
  { value: 'young adult', label: 'Young adult' },
  { value: 'middle-aged', label: 'Middle-aged' },
  { value: 'elderly', label: 'Elderly' },
]

export const VOICE_GENDER_OPTIONS: { value: VoiceGender; label: string }[] = [
  { value: '', label: 'Preset default' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]

export const VOICE_ACCENT_OPTIONS: { value: VoiceAccent; label: string }[] = [
  { value: '', label: 'Preset default' },
  { value: 'american', label: 'American' },
  { value: 'british', label: 'British' },
  { value: 'australian', label: 'Australian' },
  { value: 'canadian', label: 'Canadian' },
  { value: 'indian', label: 'Indian' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'korean', label: 'Korean' },
  { value: 'japanese', label: 'Japanese' },
]

export function defaultTtsConfig(): TtsConfig {
  return {
    enabled: true,
    engine: 'browser',
    browserVoiceURI: null,
    omniHost: DEFAULT_OMNI_HOST,
    omniVoice: 'auto',
    omniModel: 'omnivoice',
    voiceAge: '',
    voiceGender: '',
    voiceAccent: '',
  }
}

function strEnum<T extends string>(v: unknown, allowed: Set<T>, fallback: T): T {
  return typeof v === 'string' && allowed.has(v as T) ? (v as T) : fallback
}

export function normalizeTtsConfig(raw: Partial<TtsConfig> | null): TtsConfig {
  const d = defaultTtsConfig()
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    engine: raw?.engine === 'omnivoice' ? 'omnivoice' : 'browser',
    browserVoiceURI:
      typeof raw?.browserVoiceURI === 'string' && raw.browserVoiceURI.trim()
        ? raw.browserVoiceURI.trim()
        : null,
    omniHost:
      typeof raw?.omniHost === 'string' && raw.omniHost.trim()
        ? raw.omniHost.trim().replace(/\/+$/, '')
        : d.omniHost,
    omniVoice:
      typeof raw?.omniVoice === 'string' && raw.omniVoice.trim()
        ? raw.omniVoice.trim()
        : d.omniVoice,
    omniModel:
      typeof raw?.omniModel === 'string' && raw.omniModel.trim()
        ? raw.omniModel.trim()
        : d.omniModel,
    voiceAge: strEnum(
      raw?.voiceAge,
      new Set(VOICE_AGE_OPTIONS.map((o) => o.value)),
      '',
    ),
    voiceGender: strEnum(
      raw?.voiceGender,
      new Set(VOICE_GENDER_OPTIONS.map((o) => o.value)),
      '',
    ),
    voiceAccent: strEnum(
      raw?.voiceAccent,
      new Set(VOICE_ACCENT_OPTIONS.map((o) => o.value)),
      '',
    ),
  }
}

const listeners = new Set<() => void>()
let snap = normalizeTtsConfig(loadJson<Partial<TtsConfig> | null>(KEY, null))

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

export function getTtsConfig(): TtsConfig {
  return snap
}

export function useTtsConfig(): TtsConfig {
  return useSyncExternalStore(subscribe, getTtsConfig, getTtsConfig)
}

export function patchTtsConfig(patch: Partial<TtsConfig>): void {
  snap = normalizeTtsConfig({ ...snap, ...patch })
  emit()
}

export function composeVoiceInstruct(voice: VoiceDesign): string | null {
  const parts: string[] = []
  if (voice.voiceGender) parts.push(voice.voiceGender)
  if (voice.voiceAge) parts.push(voice.voiceAge)
  if (voice.voiceAccent) parts.push(`${voice.voiceAccent} accent`)
  return parts.length ? parts.join(', ') : null
}
