import { useSyncExternalStore } from 'react'
import {
  loadJson,
  loadSessionJson,
  newId,
  removeJson,
  removeSessionJson,
  saveJson,
} from '../storage'
import { defaultWebSources } from '../web/types'
import {
  articlesKey,
  chatKey,
  digestKey,
  droppedKey,
  LEGACY_ARTICLES_KEY,
  LEGACY_CHAT_KEY,
  LEGACY_DIGEST_KEY,
  LEGACY_DROPPED_KEY,
  LEGACY_PREFS_KEY,
  LEGACY_USER_PROFILE_KEY,
  LEGACY_WEATHER_TALK_KEY,
  prefsKey,
  profileDataKeys,
  PROFILES_KEY,
  weatherTalkKey,
  WEB_KEY,
} from './keys'
import {
  emptyUserProfile,
  normalizeTopicList,
  normalizeUserProfile,
  normalizeWebSources,
  profileDisplayLabel,
  type ProfileRecord,
  type UserProfile,
} from './types'

export type ProfilesSnapshot = {
  profiles: ProfileRecord[]
  activeId: string
}

export type NewsPrefsPatch = {
  sources?: Partial<ProfileRecord['sources']>
  topics?: string[]
  ignoreTopics?: string[]
}

type ProfileSwitchHook = (prevId: string, nextId: string) => void

const listeners = new Set<() => void>()
const willChange = new Set<ProfileSwitchHook>()
const didChange = new Set<ProfileSwitchHook>()

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeProfileRecord(
  raw: Partial<ProfileRecord> | null | undefined,
  fallbackId?: string,
): ProfileRecord {
  const id = str(raw?.id).trim() || fallbackId || newId()
  const user = normalizeUserProfile(
    raw && typeof raw === 'object' && raw.user && typeof raw.user === 'object'
      ? raw.user
      : raw && typeof raw === 'object'
        ? (raw as unknown as Partial<UserProfile>)
        : null,
  )
  const label = str(raw?.label)
  return {
    id,
    label,
    user,
    sources: normalizeWebSources(raw?.sources),
    topics: normalizeTopicList(raw?.topics),
    ignoreTopics: normalizeTopicList(raw?.ignoreTopics),
  }
}

function nextProfileLabel(profiles: ProfileRecord[]): string {
  const used = new Set(profiles.map((p) => p.label.trim().toLowerCase()))
  let n = profiles.length + 1
  while (used.has(`profile ${n}`)) n += 1
  return `Profile ${n}`
}

function makeProfile(
  seed?: Partial<ProfileRecord> & { user?: Partial<UserProfile> },
  label?: string,
): ProfileRecord {
  return normalizeProfileRecord({
    id: newId(),
    label: label ?? 'Profile',
    user: seed?.user ? { ...emptyUserProfile(), ...seed.user } : emptyUserProfile(),
    sources: seed?.sources ?? defaultWebSources(),
    topics: seed?.topics ?? [],
    ignoreTopics: seed?.ignoreTopics ?? [],
  })
}

function moveLocalKey(from: string, to: string): void {
  const existing = loadJson<unknown>(to, null)
  if (existing != null) {
    removeJson(from)
    return
  }
  const value = loadJson<unknown>(from, null)
  if (value == null) {
    removeJson(from)
    return
  }
  saveJson(to, value)
  removeJson(from)
}

function migrateLegacyChat(profileId: string): void {
  const dest = chatKey(profileId)
  if (loadJson<unknown>(dest, null) != null) {
    removeSessionJson(LEGACY_CHAT_KEY)
    return
  }
  const raw = loadSessionJson<unknown>(LEGACY_CHAT_KEY, null)
  if (raw != null) saveJson(dest, raw)
  removeSessionJson(LEGACY_CHAT_KEY)
}

function slimWebConfig(raw: Record<string, unknown> | null): void {
  if (!raw || typeof raw !== 'object') return
  saveJson(WEB_KEY, {
    enabled: raw.enabled === true,
    jinaApiKey: typeof raw.jinaApiKey === 'string' ? raw.jinaApiKey.trim() : '',
  })
}

function migrateFromLegacy(): ProfilesSnapshot {
  const legacyUser = loadJson<Partial<UserProfile> | null>(
    LEGACY_USER_PROFILE_KEY,
    null,
  )
  const rawWeb = loadJson<Record<string, unknown> | null>(WEB_KEY, null)
  const user = normalizeUserProfile(legacyUser)
  const label = user.name.trim() || 'Default'
  const profile = normalizeProfileRecord({
    id: newId(),
    label,
    user,
    sources: normalizeWebSources(rawWeb?.sources),
    topics: normalizeTopicList(rawWeb?.topics),
    ignoreTopics: normalizeTopicList(rawWeb?.ignoreTopics),
  })
  moveLocalKey(LEGACY_DIGEST_KEY, digestKey(profile.id))
  moveLocalKey(LEGACY_PREFS_KEY, prefsKey(profile.id))
  moveLocalKey(LEGACY_ARTICLES_KEY, articlesKey(profile.id))
  moveLocalKey(LEGACY_DROPPED_KEY, droppedKey(profile.id))
  moveLocalKey(LEGACY_WEATHER_TALK_KEY, weatherTalkKey(profile.id))
  migrateLegacyChat(profile.id)
  slimWebConfig(rawWeb)
  removeJson(LEGACY_USER_PROFILE_KEY)
  return { profiles: [profile], activeId: profile.id }
}

function loadSnapshot(): ProfilesSnapshot {
  const stored = loadJson<{
    activeId?: unknown
    profiles?: unknown
  } | null>(PROFILES_KEY, null)
  if (stored && Array.isArray(stored.profiles) && stored.profiles.length) {
    const profiles = stored.profiles.map((row) =>
      normalizeProfileRecord(
        row && typeof row === 'object' ? (row as Partial<ProfileRecord>) : null,
      ),
    )
    const savedActive = str(stored.activeId)
    const activeId = profiles.some((p) => p.id === savedActive)
      ? savedActive
      : profiles[0]!.id
    return { profiles, activeId }
  }
  return migrateFromLegacy()
}

let snap = loadSnapshot()
saveJson(PROFILES_KEY, snap)

function emit(): void {
  saveJson(PROFILES_KEY, snap)
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): ProfilesSnapshot {
  return snap
}

function activate(id: string): boolean {
  if (id === snap.activeId) return false
  if (!snap.profiles.some((p) => p.id === id)) return false
  const prev = snap.activeId
  for (const fn of willChange) fn(prev, id)
  snap = { ...snap, activeId: id }
  emit()
  for (const fn of didChange) fn(prev, id)
  return true
}

function insertAndActivate(record: ProfileRecord): ProfileRecord {
  const prev = snap.activeId
  for (const fn of willChange) fn(prev, record.id)
  snap = {
    profiles: [...snap.profiles, record],
    activeId: record.id,
  }
  emit()
  for (const fn of didChange) fn(prev, record.id)
  return record
}

function wipeProfileData(id: string): void {
  for (const key of profileDataKeys(id)) removeJson(key)
}

function activeRecord(): ProfileRecord {
  return snap.profiles.find((p) => p.id === snap.activeId) ?? snap.profiles[0]!
}

function patchActive(next: ProfileRecord): void {
  snap = {
    ...snap,
    profiles: snap.profiles.map((p) => (p.id === next.id ? next : p)),
  }
  emit()
}

export function subscribeProfiles(fn: () => void): () => void {
  return subscribe(fn)
}

export function onProfileWillChange(fn: ProfileSwitchHook): () => void {
  willChange.add(fn)
  return () => {
    willChange.delete(fn)
  }
}

export function onProfileDidChange(fn: ProfileSwitchHook): () => void {
  didChange.add(fn)
  return () => {
    didChange.delete(fn)
  }
}

export function useProfiles(): ProfilesSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getProfiles(): ProfileRecord[] {
  return snap.profiles
}

export function getActiveProfileId(): string {
  return snap.activeId
}

export function getActiveProfile(): ProfileRecord {
  return activeRecord()
}

export function getUserProfile(): UserProfile {
  return activeRecord().user
}

export function useUserProfile(): UserProfile {
  return useSyncExternalStore(subscribe, getUserProfile, getUserProfile)
}

export function setActiveProfile(id: string): void {
  activate(id)
}

export function patchUserProfile(patch: Partial<UserProfile>): void {
  const current = activeRecord()
  patchActive({
    ...current,
    user: normalizeUserProfile({ ...current.user, ...patch }),
  })
}

export function patchActiveLabel(label: string): void {
  const current = activeRecord()
  patchActive({ ...current, label })
}

export function patchActiveNewsPrefs(patch: NewsPrefsPatch): void {
  const current = activeRecord()
  patchActive(
    normalizeProfileRecord({
      ...current,
      sources: patch.sources
        ? { ...current.sources, ...patch.sources }
        : current.sources,
      topics: patch.topics ?? current.topics,
      ignoreTopics: patch.ignoreTopics ?? current.ignoreTopics,
    }),
  )
}

export function resetActiveProfile(): void {
  const current = activeRecord()
  patchActive({
    ...current,
    user: emptyUserProfile(),
    sources: defaultWebSources(),
    topics: [],
    ignoreTopics: [],
  })
}

export function resetUserProfile(): void {
  resetActiveProfile()
}

export function addProfile(): ProfileRecord {
  return insertAndActivate(makeProfile(undefined, nextProfileLabel(snap.profiles)))
}

export function duplicateProfile(id: string): ProfileRecord | null {
  const src = snap.profiles.find((p) => p.id === id)
  if (!src) return null
  return insertAndActivate(
    makeProfile(
      {
        user: { ...src.user },
        sources: { ...src.sources },
        topics: [...src.topics],
        ignoreTopics: [...src.ignoreTopics],
      },
      `${profileDisplayLabel(src)} copy`,
    ),
  )
}

export function deleteProfile(id: string): void {
  if (snap.profiles.length <= 1) return
  if (!snap.profiles.some((p) => p.id === id)) return
  if (snap.activeId === id) {
    const next = snap.profiles.find((p) => p.id !== id)
    if (next) activate(next.id)
  }
  snap = {
    profiles: snap.profiles.filter((p) => p.id !== id),
    activeId: snap.activeId,
  }
  emit()
  wipeProfileData(id)
}

export type ImportProfilesResult = {
  added: number
  updated: number
}

/** Merge exported profiles into this device. Same ids update; new ids are added. */
export function importProfiles(rawProfiles: unknown[]): ImportProfilesResult {
  const incoming = rawProfiles.map((row) =>
    normalizeProfileRecord(
      row && typeof row === 'object' ? (row as Partial<ProfileRecord>) : null,
    ),
  )
  if (!incoming.length) return { added: 0, updated: 0 }

  const next = [...snap.profiles]
  const indexById = new Map(next.map((p, i) => [p.id, i]))
  let added = 0
  let updated = 0

  for (const rec of incoming) {
    const idx = indexById.get(rec.id)
    if (idx != null) {
      next[idx] = rec
      updated += 1
    } else {
      indexById.set(rec.id, next.length)
      next.push(rec)
      added += 1
    }
  }

  const activateId =
    incoming.length === 1 ? incoming[0]!.id : snap.activeId
  if (activateId !== snap.activeId) {
    const prev = snap.activeId
    for (const fn of willChange) fn(prev, activateId)
    snap = { profiles: next, activeId: activateId }
    emit()
    for (const fn of didChange) fn(prev, activateId)
  } else {
    snap = { profiles: next, activeId: snap.activeId }
    emit()
  }
  return { added, updated }
}
