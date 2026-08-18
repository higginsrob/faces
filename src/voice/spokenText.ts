/** Same-length stand-in so "A.I." periods are not sentence boundaries. */
const INITIALISM_DOT = '\uE000'
const URL_PERIOD = '\uE001'
const URL_QMARK = '\uE002'
const URL_BANG = '\uE003'
const NUMERIC_DOT = '\uE004'
const ABBREV_DOT = '\uE005'

/** Protocol, www, host/path, then dotted hosts (left-first). */
const URL_LIKE =
  /https?:\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::[0-9]+)?\/[^\s<>]*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi

const URL_STRIP =
  /https?:\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::[0-9]+)?\/[^\s<>]*/gi

const TRAILING_LINK =
  /(?:\r?\n|^)[ \t]*(?:LINK\s*:[^\n]*|(?:https?:\/\/|www\.)[^\s\n]*)\s*$/i

const MARKDOWN_LINK = /\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)\s]+\)/g

const EMAIL = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g

const ABBREVIATION =
  /\b(?:Mr|Mrs|Ms|Mz|Dr|Prof|Sr|Jr|vs|etc|Inc|Ltd|Co|Mt|Gen|Gov|Rev|St|no|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./gi

const AMPM = /\b[ap]\.m\./gi

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]

const TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
]

function maskInitialisms(source: string): string {
  return source.replace(/\b(?:[A-Z]\.){2,}/g, (m) =>
    m.replace(/\./g, INITIALISM_DOT),
  )
}

function maskAbbreviations(source: string): string {
  return source
    .replace(AMPM, (m) => m.replaceAll('.', ABBREV_DOT))
    .replace(ABBREVIATION, (m) => m.slice(0, -1) + ABBREV_DOT)
}

function maskNumericDots(source: string): string {
  return source.replace(/-?\d*\.\d+(?:\.\d+)*/g, (m) =>
    m.replaceAll('.', NUMERIC_DOT),
  )
}

function splitUrlTrail(raw: string): { core: string; trail: string } {
  let core = raw
  let trail = ''
  while (core) {
    const last = core.at(-1)!
    if (/[.,;:!?]/.test(last)) {
      trail = last + trail
      core = core.slice(0, -1)
      continue
    }
    if (last === ')' && !core.slice(0, -1).includes('(')) {
      trail = last + trail
      core = core.slice(0, -1)
      continue
    }
    if (last === ']' && !core.slice(0, -1).includes('[')) {
      trail = last + trail
      core = core.slice(0, -1)
      continue
    }
    break
  }
  return { core, trail }
}

function replaceUrlLike(
  source: string,
  pattern: RegExp,
  replace: (core: string, trail: string) => string,
): string {
  pattern.lastIndex = 0
  return source.replace(pattern, (raw) => {
    const { core, trail } = splitUrlTrail(raw)
    if (!core) return raw
    return replace(core, trail)
  })
}

function maskUrls(source: string): string {
  return replaceUrlLike(source, URL_LIKE, (core, trail) =>
    core
      .replaceAll('.', URL_PERIOD)
      .replaceAll('?', URL_QMARK)
      .replaceAll('!', URL_BANG) + trail,
  )
}

function restoreMasks(s: string): string {
  return s
    .replaceAll(INITIALISM_DOT, '.')
    .replaceAll(URL_PERIOD, '.')
    .replaceAll(URL_QMARK, '?')
    .replaceAll(URL_BANG, '!')
    .replaceAll(NUMERIC_DOT, '.')
    .replaceAll(ABBREV_DOT, '.')
}

function dropCompleteLinkLines(text: string): string {
  return text
    .replace(/^[ \t]*LINK\s*:.*$/gim, '')
    .replace(/^[ \t]*(?:https?:\/\/|www\.)\S+[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
}

function splitTrailingLinkMeta(buffer: string): { body: string; tail: string } {
  const match = buffer.match(TRAILING_LINK)
  if (!match || match.index == null) return { body: buffer, tail: '' }
  return {
    body: buffer.slice(0, match.index),
    tail: buffer.slice(match.index),
  }
}

function belowThousand(n: number): string {
  if (n < 10) return ONES[n]!
  if (n < 20) return TEENS[n - 10]!
  if (n < 100) {
    const ones = n % 10
    const ten = TENS[Math.floor(n / 10)]!
    return ones ? `${ten} ${ONES[ones]}` : ten
  }
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const head = `${ONES[hundreds]} hundred`
  return rest ? `${head} ${belowThousand(rest)}` : head
}

function intToWords(n: number): string {
  if (n === 0) return 'zero'
  if (n < 0) return `minus ${intToWords(-n)}`
  const scales: [number, string][] = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ]
  const parts: string[] = []
  let rest = n
  for (const [size, name] of scales) {
    if (rest >= size) {
      parts.push(`${belowThousand(Math.floor(rest / size))} ${name}`)
      rest %= size
    }
  }
  if (rest) parts.push(belowThousand(rest))
  return parts.join(' ')
}

function intPartToWords(raw: string): string {
  if (!raw || /^0+$/.test(raw)) return 'zero'
  const n = Number(raw)
  if (!Number.isFinite(n) || n > 999_999_999_999) {
    return [...raw].map((d) => ONES[Number(d)] ?? d).join(' ')
  }
  return intToWords(n)
}

function dottedToSpoken(raw: string): string {
  const signed = raw.replace(/^[−–—]+/, '-')
  const neg = signed.startsWith('-')
  const body = (neg ? signed.slice(1) : signed).replace(/^\./, '0.')
  const parts = body.split('.')
  const spoken = parts
    .map((part, i) =>
      i === 0
        ? intPartToWords(part)
        : [...part].map((d) => ONES[Number(d)] ?? d).join(' '),
    )
    .join(' point ')
  return neg ? `minus ${spoken}` : spoken
}

function speakNumberToken(raw: string): string {
  const signed = raw.replace(/,/g, '').replace(/^[−–—]+/, '-')
  if (!signed.includes('.')) {
    const n = Number(signed)
    if (Number.isFinite(n) && Math.abs(n) <= 999_999_999_999) return intToWords(n)
    return signed
  }
  return dottedToSpoken(signed)
}

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function expandYear(year: number): number {
  if (year >= 100) return year
  return year < 70 ? 2000 + year : 1900 + year
}

function speakableDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${MONTHS[month - 1]} ${ordinal(day)}, ${expandYear(year)}`
}

function replaceDates(text: string): string {
  return text
    .replace(
      /\b(\d{4})-(\d{2})-(\d{2})(?:T[0-9:.+\-Z]+)?\b/g,
      (raw, y, mo, d) =>
        speakableDate(Number(y), Number(mo), Number(d)) ?? raw,
    )
    .replace(/\b(\d{4})-(\d{2})\b/g, (raw, y, mo) => {
      const month = Number(mo)
      if (month < 1 || month > 12) return raw
      return `${MONTHS[month - 1]} ${y}`
    })
    .replace(
      /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g,
      (raw, a, b, y) => {
        const first = Number(a)
        const second = Number(b)
        const year = Number(y)
        if (first > 12 && second <= 12) {
          return speakableDate(year, second, first) ?? raw
        }
        if (first <= 12) return speakableDate(year, first, second) ?? raw
        return raw
      },
    )
    .replace(/\b(\d{4})[-–—](\d{4})\b/g, '$1 to $2')
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
}

function replaceStrangeUtterances(text: string): string {
  return text
    .replace(EMAIL, '')
    .replace(/(?<=^|\s)#(\w+)/g, '$1')
    .replace(/(?<=^|\s)@(\w+)/g, '$1')
    .replace(
      /([$€£])(\d[\d,]*(?:\.\d+)?)(\s*(?:hundred|thousand|million|billion|trillion))?/gi,
      (_raw, sym: string, num: string, scale: string | undefined) => {
        const unit = sym === '€' ? 'euros' : sym === '£' ? 'pounds' : 'dollars'
        const mag = scale?.trim() ? ` ${scale.trim().toLowerCase()}` : ''
        return `${speakNumberToken(num)}${mag} ${unit}`
      },
    )
    .replace(
      /(\d[\d,]*(?:\.\d+)?)(\s*(?:hundred|thousand|million|billion|trillion))?\s*([$€£])/gi,
      (_raw, num: string, scale: string | undefined, sym: string) => {
        const unit = sym === '€' ? 'euros' : sym === '£' ? 'pounds' : 'dollars'
        const mag = scale?.trim() ? ` ${scale.trim().toLowerCase()}` : ''
        return `${speakNumberToken(num)}${mag} ${unit}`
      },
    )
    .replace(
      /(\d[\d,]*(?:\.\d+)?)\s*°\s*([FCfc])\b/g,
      (_raw, num: string, unit: string) =>
        `${speakNumberToken(num)} degrees ${unit.toUpperCase() === 'C' ? 'Celsius' : 'Fahrenheit'}`,
    )
    .replace(
      /(\d[\d,]*(?:\.\d+)?)\s*°/g,
      (_raw, num: string) => `${speakNumberToken(num)} degrees`,
    )
    .replace(
      /(\d[\d,]*(?:\.\d+)?)\s*%/g,
      (_raw, num: string) => `${speakNumberToken(num)} percent`,
    )
    .replace(
      /\b(\d[\d,]*(?:\.\d+)?)([KMB])\b/g,
      (_raw, num: string, suffix: string) => {
        const mag =
          suffix === 'K' ? 'thousand' : suffix === 'M' ? 'million' : 'billion'
        return `${speakNumberToken(num)} ${mag}`
      },
    )
    .replace(/-?\d*\.\d+(?:\.\d+)*/g, (m) => dottedToSpoken(m))
    .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) =>
      speakNumberToken(m.replaceAll(',', '')),
    )
    .replace(/\b(\d+)-year-old\b/gi, '$1 year old')
    .replace(/\b([A-Za-z]{2,})-(\d+)\b/g, '$1 $2')
    .replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, '$1 $2')
}

export function splitSentencesWithOffsets(
  text: string,
): { text: string; start: number; end: number }[] {
  const source = text.trim()
  if (!source) return []
  const masked = maskNumericDots(
    maskAbbreviations(maskUrls(maskInitialisms(source))),
  )
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
  return texts.map(prepareSpokenAudio).filter(hasSpeakableContent)
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

/** Drop URL tokens but keep surrounding prose and newlines. */
export function stripUrls(text: string): string {
  MARKDOWN_LINK.lastIndex = 0
  return replaceUrlLike(
    text.replace(MARKDOWN_LINK, '$1'),
    URL_STRIP,
    (_core, trail) => trail,
  )
}

function stripSpeechChrome(text: string): string {
  return stripMarkdown(
    stripUrls(
      text
        .replace(/^\s*FACE\s*:[^\n]*\n*/i, '')
        .replace(/^[ \t]*LINK\s*:.*$/gim, '')
        .replace(/\bLINK\s*:\s*/gi, '')
        .replace(/<0x[0-9A-Fa-f]{2}>/gi, ''),
    ),
  )
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/<\s*>/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g, '')
}

function tidySpeech(text: string): string {
  return text.replace(/\s+([.,);:!?])/g, '$1').replace(/\s+/g, ' ').trim()
}

/** Drop metadata, URLs, and emoji. Does not rewrite numbers or dates. */
export function stripForSpeech(text: string): string {
  return tidySpeech(stripSpeechChrome(text))
}

/** TTS-only: decimals, dates, and other tokens that sound wrong aloud. */
export function prepareSpokenAudio(text: string): string {
  return tidySpeech(
    replaceStrangeUtterances(replaceDates(stripSpeechChrome(text))).replace(
      /[#*_~|\\{}<>^`]+/g,
      ' ',
    ),
  )
}

/** True when the string has a letter or digit OmniVoice can vocalize. */
export function hasSpeakableContent(text: string): boolean {
  return /\p{L}|\p{N}/u.test(text)
}

export function speakableCharCount(text: string): number {
  return (text.match(/\p{L}|\p{N}/gu) ?? []).length
}
