import { EMOTIONS } from '../emotions/catalog'
import { findPersonaByEmoji, getPersonas } from '../personas/store'
import type { Persona } from '../personas/types'

export function findAddressedPersonas(
  text: string,
  opts?: { excludeId?: string },
): Persona[] {
  const raw = text.trim()
  if (!raw) return []

  const hits: { index: number; persona: Persona }[] = []
  const seen = new Set<string>()

  const consider = (index: number, persona: Persona | undefined) => {
    if (!persona || index < 0) return
    if (opts?.excludeId && persona.id === opts.excludeId) return
    if (seen.has(persona.id)) return
    seen.add(persona.id)
    hits.push({ index, persona })
  }

  for (const emotion of EMOTIONS) {
    const index = raw.indexOf(emotion.emoji)
    if (index >= 0) consider(index, findPersonaByEmoji(emotion.emoji))
  }

  const personas = [...getPersonas()].sort(
    (a, b) => b.name.trim().length - a.name.trim().length,
  )
  for (const persona of personas) {
    const name = persona.name.trim()
    if (!name) continue
    consider(nameMentionIndex(raw, name), persona)
  }

  hits.sort((a, b) => a.index - b.index)
  return hits.map((h) => h.persona)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Prefer stored casing; also catch vocative "hey Name" / "Name," / "@Name". */
function nameMentionIndex(text: string, name: string): number {
  const n = escapeRegExp(name)
  const exact = text.search(new RegExp(`\\b${n}\\b`))
  if (exact >= 0) return exact
  const at = text.search(new RegExp(`@${n}\\b`, 'i'))
  if (at >= 0) return at
  const vocative = text.search(
    new RegExp(`(?:^|[\\s.!?])(?:hey|hi|yo|ok|okay)\\s+${n}\\b`, 'i'),
  )
  if (vocative >= 0) return vocative
  const comma = text.search(new RegExp(`\\b${n}\\s*,`, 'i'))
  if (comma >= 0) return comma
  return -1
}
