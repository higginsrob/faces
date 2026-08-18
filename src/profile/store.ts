import { useSyncExternalStore } from 'react'
import { loadJson, saveJson } from '../storage'
import {
  emptyUserProfile,
  normalizeUserProfile,
  type UserProfile,
} from './types'

const KEY = 'faces:user-profile'
const listeners = new Set<() => void>()

let snap: UserProfile = normalizeUserProfile(
  loadJson<Partial<UserProfile> | null>(KEY, null),
)

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

export function getUserProfile(): UserProfile {
  return snap
}

export function useUserProfile(): UserProfile {
  return useSyncExternalStore(subscribe, getUserProfile, getUserProfile)
}

export function patchUserProfile(patch: Partial<UserProfile>): void {
  snap = normalizeUserProfile({ ...snap, ...patch })
  emit()
}

export function resetUserProfile(): void {
  snap = emptyUserProfile()
  emit()
}
