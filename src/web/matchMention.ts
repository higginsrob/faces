import { isConversationalItem } from './age'
import { addMentionedIds, getWebDigest } from './digest'
import type { WebItem } from './types'
import { markWeatherTalkedToday, noteWeatherTalkFromText } from './weatherTalk'

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'for',
  'and',
  'to',
  'is',
  'it',
  'at',
  'by',
  'from',
  'with',
  'as',
  'or',
  'be',
  'this',
  'that',
  'its',
  'was',
  'are',
  'new',
  'over',
  'into',
  'about',
  'after',
  'before',
  'news',
  'says',
  'has',
  'have',
  'had',
  'will',
  'not',
  'but',
  'people',
  'world',
  'south',
  'north',
  'east',
  'west',
  'deaths',
  'death',
  'years',
  'year',
  'could',
  'would',
  'first',
  'during',
  'under',
  'against',
  'between',
  'through',
  'their',
  'them',
  'they',
  'who',
  'which',
  'when',
  'where',
  'what',
  'been',
  'being',
  'than',
  'more',
  'most',
  'some',
  'such',
  'only',
  'other',
  'also',
  'just',
  'today',
  'latest',
  'current',
  'events',
  'article',
  'story',
  'list',
])

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t))
}

function distinctiveTitleTokens(title: string): string[] {
  const all = tokens(title)
  const long = all.filter((t) => t.length >= 5)
  return long.length ? long : all
}

function titleNeedle(title: string): string {
  return normalize(title).replace(/^\d{4}\s+/, '')
}

export function itemMentionedInText(text: string, item: WebItem): boolean {
  const hay = normalize(text)
  if (!hay) return false
  const padded = ` ${hay} `

  const title = titleNeedle(item.title)
  if (title.length >= 8 && hay.includes(title)) return true

  const titleToks = distinctiveTitleTokens(item.title)
  if (titleToks.length === 0) return false

  for (let i = 0; i < titleToks.length - 1; i++) {
    const bigram = `${titleToks[i]} ${titleToks[i + 1]}`
    if (hay.includes(bigram)) return true
  }

  const hits = titleToks.filter((t) => padded.includes(` ${t} `))
  if (titleToks.length === 1) {
    return hits.length === 1 && titleToks[0]!.length >= 5
  }
  const need = titleToks.length <= 3 ? 2 : Math.ceil(titleToks.length * 0.4)
  if (hits.length >= need) return true

  const blurbToks = distinctiveTitleTokens(item.blurb).filter((t) => t.length >= 6)
  const blurbHits = blurbToks.filter((t) => padded.includes(` ${t} `))
  return blurbHits.length >= 2
}

function itemsRelated(a: WebItem, b: WebItem): boolean {
  if (a.id === b.id) return false
  const ta = new Set(distinctiveTitleTokens(a.title))
  const shared = distinctiveTitleTokens(b.title).filter(
    (t) => ta.has(t) && t.length >= 5,
  )
  return shared.length >= 2
}

function noteWeatherTalk(text: string): void {
  noteWeatherTalkFromText(text)
  const weather = getWebDigest().items.find((item) => item.source === 'weather')
  if (weather && itemMentionedInText(text, weather)) markWeatherTalkedToday()
}

function idsMentionedInText(text: string, items: WebItem[]): string[] {
  const spoken = text.trim()
  if (!spoken) return []
  const direct: WebItem[] = []
  for (const item of items) {
    if (!isConversationalItem(item)) continue
    if (itemMentionedInText(spoken, item)) direct.push(item)
  }
  if (!direct.length) return []
  const found = new Set(direct.map((item) => item.id))
  for (const item of items) {
    if (found.has(item.id) || !isConversationalItem(item)) continue
    if (direct.some((hit) => itemsRelated(hit, item))) found.add(item.id)
  }
  return [...found]
}

export function markWebMentionsFromReply(text: string): WebItem[] {
  noteWeatherTalk(text)
  const digest = getWebDigest()
  if (!digest.items.length) return []
  addMentionedIds(idsMentionedInText(text, digest.items))
  return digest.items.filter(
    (item) => isConversationalItem(item) && itemMentionedInText(text, item),
  )
}

export function syncWebMentionsFromMessages(
  messages: { role: string; content: string }[],
): void {
  const digest = getWebDigest()
  const found: string[] = []
  for (const m of messages) {
    if (!m.content.trim()) continue
    if (m.role === 'assistant' || m.role === 'user') {
      noteWeatherTalk(m.content)
    }
    if (m.role !== 'assistant' || !digest.items.length) continue
    found.push(...idsMentionedInText(m.content, digest.items))
  }
  addMentionedIds(found)
}
