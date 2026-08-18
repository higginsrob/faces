import {
  EMOTIONS,
  findEmotionByEmoji,
  findEmotionById,
  firstCatalogEmoji,
  isCatalogEmoji,
} from '../emotions/catalog'
import { completeOllamaChat, type ChatTurn } from '../ollama/client'
import { getPersonas } from '../personas/store'
import { parseFaceLine } from '../emotions/parseFace'
import { personaSpeakerNames, stripSpeakerPrefix } from './roomTurns'

type HistoryTurn = {
  role: string
  content: string
  personaId?: string
}

const MAX_HISTORY = 8

export function classifySpeakerPrompt(
  userText: string,
  history: HistoryTurn[],
): ChatTurn[] {
  const personas = getPersonas()
  const lines = EMOTIONS.map((emotion) => {
    const persona =
      personas.find((p) => p.id === emotion.id) ??
      personas.find((p) => p.defaultFace === emotion.emoji)
    const name = persona?.name ?? emotion.label
    return `${emotion.emoji} ${name} (${emotion.label})`
  })

  const names = personaSpeakerNames()
  const recent = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => {
      const content = stripSpeakerPrefix(m.content, names)
      if (m.role === 'user') return `User: ${content}`
      const name =
        personas.find((p) => p.id === m.personaId)?.name ?? 'Face'
      return `${name}: ${content}`
    })
    .join('\n')

  const system = `You are a silent router. Pick which catalog face should answer the user's latest message.
Reply with exactly one line and nothing else:
FACE: <emoji>

<emoji> MUST be one of the catalog faces listed below.
Pick the face whose personality best matches the user's message and the conversation.
Do not answer the user. Do not explain.`

  const user = `Faces:
${lines.join('\n')}

${recent ? `Recent conversation:\n${recent}\n\n` : ''}Latest user message:
${userText}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function parseSpeakerChoice(text: string): string | null {
  const fromLine = parseFaceLine(text)
  if (fromLine) return fromLine
  const emoji = firstCatalogEmoji(text)
  if (emoji && isCatalogEmoji(emoji)) return emoji
  const idMatch = text.match(/\b([a-z][a-z-]{1,20})\b/i)
  if (idMatch) {
    const emotion = findEmotionById(idMatch[1]!.toLowerCase())
    if (emotion) return emotion.emoji
  }
  const byName = findEmotionByEmoji(text.trim())
  return byName?.emoji ?? null
}

export async function classifySpeaker(opts: {
  userText: string
  history: HistoryTurn[]
  signal?: AbortSignal
}): Promise<string | null> {
  const content = await completeOllamaChat({
    messages: classifySpeakerPrompt(opts.userText, opts.history),
    signal: opts.signal,
    numPredict: 48,
  })
  return parseSpeakerChoice(content)
}
