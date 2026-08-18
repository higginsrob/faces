import { useSyncExternalStore } from 'react'
import { findEmotionByEmoji } from '../emotions/catalog'
import { loadJson, newId, saveJson } from '../storage'
import { BUILTIN_PERSONAS } from './builtins'
import { parsePersonaQuery, stripPersonaQuery } from './query'
import { normalizePersona, type Persona } from './types'

const PERSONAS_KEY = 'faces:personas'
const ACTIVE_KEY = 'faces:active-persona'
const ROSTER_KEY = 'faces:persona-roster'
const ROSTER = 5
const DROPPED_IDS = new Set([
  'verity',
  'buddy',
  'dude',
  'honey',
  'sage',
  'devils-advocate',
  'grump',
  'jester',
  'melt',
  'spooky',
  'bones',
  'snooze',
])

type Snapshot = {
  personas: Persona[]
  activeId: string
}

const listeners = new Set<() => void>()

function cloneBuiltins(): Persona[] {
  return BUILTIN_PERSONAS.map((p) => structuredClone(p))
}

function loadSnapshot(): Snapshot {
  const stored = loadJson<Persona[] | null>(PERSONAS_KEY, null)
  let personas =
    Array.isArray(stored) && stored.length > 0
      ? stored
          .filter((p) => typeof p?.id === 'string' && !DROPPED_IDS.has(p.id))
          .map((p) =>
            normalizePersona({
              ...p,
              id: p.id,
              name: typeof p.name === 'string' ? p.name : 'companion',
            }),
          )
      : cloneBuiltins()

  const roster = loadJson<number>(ROSTER_KEY, 0)
  if (roster < ROSTER) {
    const existingIds = new Set(personas.map((p) => p.id))
    const missing = cloneBuiltins().filter((p) => !existingIds.has(p.id))
    if (missing.length > 0) personas = [...personas, ...missing]
    const builtinsById = new Map(cloneBuiltins().map((p) => [p.id, p]))
    personas = personas.map((p) => {
      const builtin = builtinsById.get(p.id)
      if (!builtin) return p
      return normalizePersona({
        ...p,
        voiceAge: builtin.voiceAge,
        voiceGender: builtin.voiceGender,
        voiceAccent: builtin.voiceAccent,
      })
    })
    saveJson(ROSTER_KEY, ROSTER)
  }
  if (personas.length === 0) personas = cloneBuiltins()

  const savedActive = loadJson<string | null>(ACTIVE_KEY, null)
  const activeId =
    savedActive && personas.some((p) => p.id === savedActive)
      ? savedActive
      : personas[0]!.id
  return { personas, activeId }
}

let snap = loadSnapshot()
let openedFromQuery = false
ingestPersonaQuery()
saveJson(PERSONAS_KEY, snap.personas)
saveJson(ACTIVE_KEY, snap.activeId)

export function openedFromPersonaQuery(): boolean {
  return openedFromQuery
}

function ingestPersonaQuery(): void {
  if (typeof window === 'undefined') return
  const search = window.location.search
  const seed = parsePersonaQuery(search)
  stripPersonaQuery()
  if (!seed) return
  openedFromQuery = true

  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  )
  const customPersona =
    params.has('name') ||
    params.has('prompt') ||
    params.has('systemPrompt') ||
    params.has('color') ||
    params.has('sphereColor')
  if (!customPersona) {
    const emotion = findEmotionByEmoji(seed.defaultFace)
    const existing =
      (emotion && snap.personas.find((p) => p.id === emotion.id)) ||
      snap.personas.find((p) => p.defaultFace === seed.defaultFace)
    if (existing) {
      snap = { ...snap, activeId: existing.id }
      return
    }
  }

  const match = snap.personas.find(
    (p) =>
      p.name === seed.name &&
      p.defaultFace === seed.defaultFace &&
      p.systemPrompt === seed.systemPrompt &&
      p.sphereColor === seed.sphereColor,
  )
  if (match) {
    snap = { ...snap, activeId: match.id }
    return
  }

  const persona = normalizePersona({
    id: newId(),
    name: seed.name,
    sphereColor: seed.sphereColor,
    systemPrompt: seed.systemPrompt,
    defaultFace: seed.defaultFace,
  })
  snap = {
    personas: [...snap.personas, persona],
    activeId: persona.id,
  }
}

function emit(): void {
  saveJson(PERSONAS_KEY, snap.personas)
  saveJson(ACTIVE_KEY, snap.activeId)
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): Snapshot {
  return snap
}

export function usePersonas(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getPersonas(): Persona[] {
  return snap.personas
}

export function getPersonaById(id: string): Persona | undefined {
  return snap.personas.find((p) => p.id === id)
}

export function getActivePersona(): Persona {
  return snap.personas.find((p) => p.id === snap.activeId) ?? snap.personas[0]!
}

export function findPersonaByEmoji(emoji: string): Persona | undefined {
  const emotion = findEmotionByEmoji(emoji)
  return (
    (emotion && snap.personas.find((p) => p.id === emotion.id)) ||
    snap.personas.find((p) => p.defaultFace === emoji)
  )
}

export function setActivePersona(id: string): void {
  if (!snap.personas.some((p) => p.id === id)) return
  snap = { ...snap, activeId: id }
  emit()
}

export function updatePersona(id: string, patch: Partial<Persona>): void {
  snap = {
    ...snap,
    personas: snap.personas.map((p) =>
      p.id === id ? normalizePersona({ ...p, ...patch, id: p.id }) : p,
    ),
  }
  emit()
}

export function addPersona(seed?: Partial<Persona>): Persona {
  const persona = normalizePersona({
    id: newId(),
    name: seed?.name?.trim() || 'new face',
    sphereColor: seed?.sphereColor ?? '#f5c400',
    systemPrompt: seed?.systemPrompt ?? 'You are a helpful companion. Keep replies short and speakable.',
    defaultFace: seed?.defaultFace ?? '😊',
    voiceAge: seed?.voiceAge,
    voiceGender: seed?.voiceGender,
    voiceAccent: seed?.voiceAccent,
  })
  snap = {
    personas: [...snap.personas, persona],
    activeId: persona.id,
  }
  emit()
  return persona
}

export function duplicatePersona(id: string): Persona | null {
  const src = snap.personas.find((p) => p.id === id)
  if (!src) return null
  return addPersona({
    ...src,
    name: `${src.name} copy`,
  })
}

export function deletePersona(id: string): void {
  if (snap.personas.length <= 1) return
  const personas = snap.personas.filter((p) => p.id !== id)
  const activeId =
    snap.activeId === id ? personas[0]!.id : snap.activeId
  snap = { personas, activeId }
  emit()
}

export function restoreBuiltins(): void {
  const existingIds = new Set(snap.personas.map((p) => p.id))
  const missing = cloneBuiltins().filter((p) => !existingIds.has(p.id))
  if (missing.length === 0) return
  snap = { ...snap, personas: [...snap.personas, ...missing] }
  emit()
}
