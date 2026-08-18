/** Same-length stand-in so "A.I." periods are not sentence boundaries. */
const INITIALISM_DOT = '\uE000'
const URL_PERIOD = '\uE001'
const URL_QMARK = '\uE002'
const URL_BANG = '\uE003'

const TRAILING_LINK = /(?:\r?\n|^)[ \t]*LINK\s*:[^\n]*$/i

function maskInitialisms(source: string): string {
  return source.replace(/\b(?:[A-Z]\.){2,}/g, (m) =>
    m.replace(/\./g, INITIALISM_DOT),
  )
}

function maskUrls(source: string): string {
  return source.replace(/https?:\/\/[^\s<>]+/gi, (raw) => {
    const trail = raw.match(/[.,);:]+$/)
    const core = trail ? raw.slice(0, -trail[0].length) : raw
    const suffix = trail ? trail[0] : ''
    return (
      core
        .replaceAll('.', URL_PERIOD)
        .replaceAll('?', URL_QMARK)
        .replaceAll('!', URL_BANG) + suffix
    )
  })
}

function restoreMasks(s: string): string {
  return s
    .replaceAll(INITIALISM_DOT, '.')
    .replaceAll(URL_PERIOD, '.')
    .replaceAll(URL_QMARK, '?')
    .replaceAll(URL_BANG, '!')
}

function dropCompleteLinkLines(text: string): string {
  return text.replace(/^[ \t]*LINK\s*:.*$/gim, '').replace(/\n{3,}/g, '\n\n')
}

function splitTrailingLinkMeta(buffer: string): { body: string; tail: string } {
  const match = buffer.match(TRAILING_LINK)
  if (!match || match.index == null) return { body: buffer, tail: '' }
  return {
    body: buffer.slice(0, match.index),
    tail: buffer.slice(match.index),
  }
}

export function splitSentencesWithOffsets(
  text: string,
): { text: string; start: number; end: number }[] {
  const source = text.trim()
  if (!source) return []
  const masked = maskUrls(maskInitialisms(source))
  const parts = masked.match(/[^.!?]+[.!?]+|[^.!?]+$/g)
  if (!parts) return [{ text: source, start: 0, end: source.length }]
  const out: { text: string; start: number; end: number }[] = []
  let cursor = 0
  for (const raw of parts) {
    const trimmed = raw.trim()
    if (!trimmed) {
      cursor += raw.length
      continue
    }
    const local = raw.indexOf(trimmed)
    const start = cursor + (local >= 0 ? local : 0)
    const end = start + trimmed.length
    out.push({ text: restoreMasks(trimmed), start, end })
    cursor += raw.length
  }
  return out
}

function speakableSentences(texts: string[]): string[] {
  return texts.filter((s) => hasSpeakableContent(stripForSpeech(s)))
}

/** Drain complete sentences from a growing buffer; leave a trailing fragment. */
export function takeCompleteSentences(buffer: string): {
  sentences: string[]
  rest: string
} {
  const { body, tail } = splitTrailingLinkMeta(buffer)
  const cleaned = dropCompleteLinkLines(body)
  const spans = splitSentencesWithOffsets(cleaned)
  if (spans.length === 0) {
    return { sentences: [], rest: tail ? `${cleaned}${tail}` : buffer }
  }
  const last = spans[spans.length - 1]!
  const lastComplete = /[.!?]$/.test(last.text)
  if (lastComplete) {
    return {
      sentences: speakableSentences(spans.map((s) => s.text)),
      rest: tail,
    }
  }
  if (spans.length === 1) return { sentences: [], rest: buffer }
  return {
    sentences: speakableSentences(spans.slice(0, -1).map((s) => s.text)),
    rest: `${cleaned.slice(last.start)}${tail}`,
  }
}

export function stripForSpeech(text: string): string {
  return text
    .replace(/^\s*FACE\s*:[^\n]*\n*/i, '')
    .replace(/^[ \t]*LINK\s*:.*$/gim, '')
    .replace(/\bLINK\s*:\s*/gi, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when the string has a letter or digit OmniVoice can vocalize. */
export function hasSpeakableContent(text: string): boolean {
  return /\p{L}|\p{N}/u.test(text)
}

export function speakableCharCount(text: string): number {
  return (text.match(/\p{L}|\p{N}/gu) ?? []).length
}
