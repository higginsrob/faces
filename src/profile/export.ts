import { profileDisplayLabel, type ProfileRecord } from './types'

export const PROFILES_EXPORT_KIND = 'profiles'
export const PROFILES_EXPORT_VERSION = 1

export type ProfilesFile = {
  exportedAt: string
  app: 'faces'
  kind: typeof PROFILES_EXPORT_KIND
  version: number
  profiles: ProfileRecord[]
}

export type ProfilesParseResult =
  | { ok: true; profiles: unknown[] }
  | { ok: false; error: string }

export function downloadProfilesExport(
  profiles: ProfileRecord[],
  mode: 'one' | 'all',
): void {
  const exportedAt = new Date().toISOString()
  const payload: ProfilesFile = {
    exportedAt,
    app: 'faces',
    kind: PROFILES_EXPORT_KIND,
    version: PROFILES_EXPORT_VERSION,
    profiles,
  }
  const stamp = exportedAt.slice(0, 19).replace(/:/g, '-')
  const name =
    mode === 'all'
      ? `faces-profiles-${stamp}.json`
      : `faces-profile-${slug(profileDisplayLabel(profiles[0]!))}-${stamp}.json`
  downloadJson(name, payload)
}

export async function readProfilesFile(file: File): Promise<ProfilesParseResult> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, error: 'Could not read that file.' }
  }
  return parseProfilesExport(text)
}

export function parseProfilesExport(text: string): ProfilesParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'That file is not a Faces profile export.' }
  }
  const obj = data as Record<string, unknown>
  if (obj.kind !== PROFILES_EXPORT_KIND) {
    return { ok: false, error: 'That file is not a Faces profile export.' }
  }
  if (!Array.isArray(obj.profiles) || !obj.profiles.length) {
    return { ok: false, error: 'No profiles found in that file.' }
  }
  const profiles = obj.profiles.filter(
    (row) => row && typeof row === 'object' && !Array.isArray(row),
  )
  if (!profiles.length) {
    return { ok: false, error: 'No profiles found in that file.' }
  }
  return { ok: true, profiles }
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'profile'
}
