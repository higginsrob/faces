import { completeOllamaChat } from '../ollama/client'
import { getRerankConfig } from '../ollama/rerankStore'
import { getOllamaConfig } from '../ollama/store'

const JUNK =
  /enable javascript|checking your browser|access denied|page not found|404 not found|just a moment|are you a robot|verify you are human|sign in to (continue|read)|log in to continue|subscribe to (continue|read)|create a free account|cookie (consent|settings|policy)|please enable cookies|attention required|cf-browser-verification/i

const ASK_NOISE = new Set([
  'more',
  'details',
  'read',
  'article',
  'source',
  'deeper',
  'explain',
  'happened',
  'full',
  'story',
  'please',
  'tell',
  'about',
  'does',
  'they',
  'into',
  'expand',
  'what',
  'when',
  'where',
  'which',
  'would',
  'could',
  'should',
  'this',
  'that',
  'with',
  'from',
  'have',
  'been',
  'your',
  'video',
  'transcript',
])

export type ArticleClaim = {
  title: string
  blurb?: string
  topic?: string
  question?: string
  kind?: 'article' | 'transcript'
}

export function droppedSourceMessage(kind?: 'article' | 'transcript'): string {
  return kind === 'transcript'
    ? 'That video did not have the story, so it was dropped.'
    : 'That page did not have the story, so it was dropped.'
}

/** False when the fetched text is junk, off-topic, or does not support the claim. */
export async function articleSupportsClaim(
  body: string,
  claim: ArticleClaim,
  signal?: AbortSignal,
): Promise<boolean> {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (heuristicReject(text, claim)) return false
  const judged = await llmRelevant(text, claim, signal)
  if (judged == null) return true
  return judged
}

function claimTerms(text: string, min = 4): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const term = part.trim()
    if (term.length < min || ASK_NOISE.has(term) || seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}

function heuristicReject(body: string, claim: ArticleClaim): boolean {
  if (JUNK.test(body) && body.length < 1200) return true
  if (claim.kind === 'transcript') return false
  const titleTerms = claimTerms(claim.title).slice(0, 10)
  const titleHits = countHits(body, titleTerms)
  if (titleTerms.length >= 4 && titleHits === 0) return true
  if (titleTerms.length >= 6 && titleHits < 2) return true

  const questionTerms = claimTerms(claim.question ?? '')
  if (questionTerms.length >= 3 && countHits(body, questionTerms) === 0) return true
  return false
}

function countHits(body: string, terms: string[]): number {
  const hay = body.toLowerCase()
  let n = 0
  for (const term of terms) {
    if (hay.includes(term)) n += 1
  }
  return n
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseRelevant(raw: string): boolean | null {
  const obj = extractJsonObject(raw)
  if (!obj) return null
  const value = obj.relevant
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase()
    if (t === 'true' || t === 'yes' || t === '1') return true
    if (t === 'false' || t === 'no' || t === '0') return false
  }
  return null
}

async function llmRelevant(
  body: string,
  claim: ArticleClaim,
  signal?: AbortSignal,
): Promise<boolean | null> {
  const rerank = getRerankConfig()
  const chat = getOllamaConfig()
  const model = rerank.model.trim() || chat.model.trim()
  if (!model) return null
  const what = claim.kind === 'transcript' ? 'video transcript' : 'page'
  const blurb = claim.blurb?.trim()
  const topic = claim.topic?.trim()
  const question = claim.question?.trim()
  const extras = [
    blurb ? `Blurb: ${blurb}` : '',
    topic ? `Topic: ${topic}` : '',
    question ? `User question: ${question}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const raw = await completeOllamaChat({
      messages: [
        {
          role: 'system',
          content:
            'You check whether a fetched source actually supports a claimed story. Return JSON only. No markdown.',
        },
        {
          role: 'user',
          content: `Claimed title: ${claim.title}
${extras}

Mark relevant false if this ${what} is a homepage, search results, login/paywall, cookie wall, error page, spam, or a different story; or if the main text does not contain the claimed story${question ? ' or does not answer the user question' : ''}. Mark relevant true only if the main text is about the claimed story${question ? ' and can answer the question' : ''}. Return JSON: {"relevant":true} or {"relevant":false}

${body.slice(0, 2800)}`,
        },
      ],
      signal,
      model,
      keepAlive: rerank.model.trim() ? rerank.keep_alive : undefined,
      temperature: 0,
      numPredict: 40,
    })
    return parseRelevant(raw)
  } catch {
    return null
  }
}
