import { completeOllamaChat } from '../ollama/client'
import { getOllamaConfig } from '../ollama/store'
import { getUserProfile } from '../profile/store'
import { stripForSpeech, stripUrls } from '../voice/spokenText'
import { filterItemsForAge, isConversationalItem, newsAccess } from './age'
import type { OpenArticle, WebItem } from './types'

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function summarizeDigestItems(
  items: WebItem[],
  age: string,
  signal?: AbortSignal,
): Promise<WebItem[]> {
  const cfg = getOllamaConfig()
  if (!cfg.model) return items
  const conversational = items
    .filter(isConversationalItem)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 20)
  if (!conversational.length) return items

  const access = newsAccess(age)
  const ageNote =
    access === 'teen'
      ? 'Keep blurbs appropriate for a teenager. Drop graphic or adult items.'
      : access === 'child'
        ? 'Drop anything not suitable for a child.'
        : 'Keep blurbs short and spoken-friendly.'

  const payload = conversational.map((item) => ({
    id: item.id,
    title: item.title,
    blurb: item.blurb,
    source: item.source,
    topic: item.topic,
  }))

  try {
    const raw = await completeOllamaChat({
      messages: [
        {
          role: 'system',
          content:
            'You rewrite a daily briefing. Return JSON only. No markdown.',
        },
        {
          role: 'user',
          content: `${ageNote}

Rewrite each blurb as one short spoken sentence. Keep every item. Do not drop, merge, or skip any id. Return JSON: [{"id":"...","blurb":"..."}]

${JSON.stringify(payload)}`,
        },
      ],
      signal,
      numPredict: 1600,
    })
    const parsed = extractJsonArray(raw)
    if (!parsed?.length) return items
    const blurbs = new Map<string, string>()
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const o = row as { id?: unknown; blurb?: unknown }
      if (typeof o.id !== 'string' || typeof o.blurb !== 'string') continue
      const blurb = o.blurb.trim()
      if (!blurb) continue
      blurbs.set(o.id, blurb)
    }
    if (!blurbs.size) return items
    const kept = items.map((item) => {
      const blurb = blurbs.get(item.id)
      return blurb ? { ...item, blurb } : item
    })
    return filterItemsForAge(kept, age)
  } catch {
    return items
  }
}

function ageNoteForSpeech(age: string): string {
  const access = newsAccess(age)
  if (access === 'teen') {
    return 'Keep it appropriate for a teenager. Skip graphic or adult details.'
  }
  if (access === 'child') {
    return 'Keep it suitable for a child. Skip anything graphic or adult.'
  }
  return 'Keep it factual and easy to hear.'
}

function cleanSpokenSummary(raw: string): string {
  let text = raw.trim()
  if (!text) return ''
  text = text.replace(/^```(?:\w+)?\s*|\s*```$/g, '').trim()
  text = text.replace(/^["“']+|["”']+$/g, '').trim()
  text = text.replace(
    /^(here(?:'s| is) (?:a |the )?(?:spoken )?summary[:\s]+)/i,
    '',
  ).trim()
  return stripForSpeech(text)
}

/** A few spoken sentences covering the loaded article. Empty if none. */
export async function summarizeArticleForSpeech(
  article: Pick<OpenArticle, 'title' | 'body' | 'host' | 'kind'>,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = getOllamaConfig()
  if (!cfg.model) return ''
  const body = stripUrls(article.body.trim()).replace(/[ \t]{2,}/g, ' ').trim()
  if (!body) return ''
  const age = getUserProfile().age
  const host = article.host.trim()
  const sourceLine = host ? `Source: ${host}\n` : ''
  const transcript = article.kind === 'transcript'
  const what = transcript ? 'video transcript' : 'article'

  try {
    const raw = await completeOllamaChat({
      messages: [
        {
          role: 'system',
          content:
            'You write a spoken news summary. Return plain sentences only. No markdown, title, bullets, or preamble.',
        },
        {
          role: 'user',
          content: `${ageNoteForSpeech(age)}

Write a summary of this ${what} meant to be read aloud. Three to five short sentences. Cover the facts, not commentary. Do not mention the URL, that this is a summary, or that you are an AI.

Title: ${article.title}
${sourceLine}${body}`,
        },
      ],
      signal,
      numPredict: 420,
    })
    const summary = cleanSpokenSummary(raw)
    if (summary.length < 40) return ''
    return summary
  } catch {
    return ''
  }
}
