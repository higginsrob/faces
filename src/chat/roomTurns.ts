import type { ChatTurn } from '../ollama/client'
import { getPersonaById, getPersonas } from '../personas/store'
import type { Persona } from '../personas/types'

export type RoomHistoryMessage = {
  role: string
  content: string
  personaId?: string
}

const SPEAKER_PREFIX = /^\(\s*([^)]+?)\s*\)\s*:?\s*/
const ROOM_NOTE_PREFIX = /^\[Not you — [^\]]+ already answered\]\s*/i
const MAX_PREFIX_HOLD = 120

export function personaSpeakerNames(): string[] {
  return getPersonas()
    .map((p) => p.name.trim())
    .filter(Boolean)
}

export function stripSpeakerPrefix(
  text: string,
  names: readonly string[] = personaSpeakerNames(),
): string {
  let out = text
  for (let i = 0; i < 3; i++) {
    const next = stripSpeakerPrefixOnce(out, names)
    if (next === out) return out
    out = next
  }
  return out
}

function stripSpeakerPrefixOnce(
  text: string,
  names: readonly string[],
): string {
  const rest = text.replace(/^\s+/, '')
  const note = rest.match(ROOM_NOTE_PREFIX)
  if (note) return rest.slice(note[0].length)
  const match = rest.match(SPEAKER_PREFIX)
  if (!match) return text
  const label = match[1]!.trim().toLowerCase()
  if (!label) return text
  const known = names.some((n) => n.toLowerCase() === label)
  if (!known) return text
  return rest.slice(match[0].length)
}

export function createSpeakerPrefixGate(
  names: readonly string[] = personaSpeakerNames(),
): { push: (delta: string) => string; finish: () => string } {
  let hold = ''
  let open = true

  const release = (text: string): string => {
    open = false
    hold = ''
    return text
  }

  return {
    push(delta: string): string {
      if (!open) return delta
      hold += delta
      const trimmed = hold.replace(/^\s+/, '')
      if (trimmed.startsWith('(')) {
        if (/^\s*\([^)]*\)/.test(hold)) {
          return release(stripSpeakerPrefix(hold, names))
        }
      } else if (trimmed.startsWith('[')) {
        if (hold.includes(']')) {
          return release(stripSpeakerPrefix(hold, names))
        }
      } else {
        return release(hold)
      }
      if (hold.length >= MAX_PREFIX_HOLD || hold.includes('\n')) {
        return release(hold)
      }
      return ''
    },
    finish(): string {
      if (!open) return ''
      return release(stripSpeakerPrefix(hold, names))
    },
  }
}

function speakerLabel(personaId: string | undefined): string {
  if (!personaId) return 'Face'
  return getPersonaById(personaId)?.name ?? 'Face'
}

function roomNote(personaId: string | undefined, content: string): string {
  return `[Not you — ${speakerLabel(personaId)} already answered]\n${content}`
}

/** Build chat turns so only `persona` is the assistant; others are room notes. */
export function buildRoomTurns(
  persona: Persona,
  messages: readonly RoomHistoryMessage[],
  systemContent: string,
  opts?: { streaming?: boolean },
): ChatTurn[] {
  const names = personaSpeakerNames()
  const turns: ChatTurn[] = [{ role: 'system', content: systemContent }]

  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (
      m.role === 'assistant' &&
      !m.content.trim() &&
      opts?.streaming
    ) {
      continue
    }

    const content = stripSpeakerPrefix(m.content, names)
    if (m.role === 'user') {
      turns.push({ role: 'user', content })
      continue
    }
    if (!content.trim()) continue

    if (m.personaId && m.personaId !== persona.id) {
      const note = roomNote(m.personaId, content)
      const last = turns[turns.length - 1]
      if (last?.role === 'user') {
        last.content = `${last.content}\n\n${note}`
      } else {
        turns.push({ role: 'user', content: note })
      }
      continue
    }

    turns.push({ role: 'assistant', content })
  }

  return turns
}
