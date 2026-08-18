import { completeOllamaChat } from '../ollama/client'
import { getOllamaConfig } from '../ollama/store'
import { filterItemsForAge, isConversationalItem, newsAccess } from './age'
import type { WebItem } from './types'

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
