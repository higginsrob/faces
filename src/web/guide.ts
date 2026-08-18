import { completeOllamaChat, type ChatTurn } from '../ollama/client'
import { getOllamaConfig } from '../ollama/store'
import { formatUserProfileContext } from '../chat/systemPrompt'
import { getUserProfile } from '../profile/store'
import {
  cleanTopicList,
  MAX_CARE_TOPICS,
  MAX_SKIP_TOPICS,
} from './topics'
import { findTopicOverlaps, type TopicOverlap } from './topicConflict'

export type GuideLists = {
  topics: string[]
  ignoreTopics: string[]
}

export type GuideModelTurn = {
  say: string
  ready: boolean
  addTopics: string[]
  addIgnore: string[]
}

const SYSTEM = `You interview one person to fill two news-topic lists for a daily briefing fetched by search.

CARE ABOUT (max ${MAX_CARE_TOPICS}): extra subjects to fetch. Short search phrases, not sentences.
DO NOT CARE ABOUT (max ${MAX_SKIP_TOPICS}): subjects to skip unless they ask. Same naming rules.

Naming:
- Prefer 1–4 words. Ambiguous short words need a hint in parentheses, like drums (music).
- Same word with different hints is fine on opposite lists, like drums (music) vs drums (oil).
- Unhinted drums vs drums (oil) is a conflict. "climate" vs "climate change" is a conflict.
- Do not invent hobbies they did not mention. Tighten what they said into searchable topics.

Interview:
- Ask one question at a time. Be brief and concrete.
- Use the profile as background; do not recite it.
- Turn answers into addTopics / addIgnore. The app adds them and will ask the user before removing anything that overlaps the other list.
- If they contradict a list, propose the new item anyway. Do not silently delete.
- You cannot finish while overlaps remain. Help them choose which list keeps the subject, or add distinguishing hints.
- ready=true only when both lists are useful, overlap-free, and they seem done. Never set ready on the first turn.

Return JSON only. No markdown. Shape:
{"say":"question or note","ready":false,"addTopics":[],"addIgnore":[]}`

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1] ?? text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asStringArray(value: unknown, limit: number): string[] {
  return cleanTopicList(value, limit)
}

export function parseGuideTurn(raw: string): GuideModelTurn {
  const obj = extractJsonObject(raw)
  const say =
    obj && typeof obj.say === 'string'
      ? obj.say.trim()
      : raw.replace(/```(?:json)?[\s\S]*```/g, '').trim()
  return {
    say: say || 'What kinds of news do you actually want in the briefing?',
    ready: obj?.ready === true,
    addTopics: asStringArray(obj?.addTopics, MAX_CARE_TOPICS),
    addIgnore: asStringArray(obj?.addIgnore, MAX_SKIP_TOPICS),
  }
}

export function formatGuideLists(lists: GuideLists, overlaps: TopicOverlap[]): string {
  const care = lists.topics.length ? lists.topics.join(', ') : '(empty)'
  const skip = lists.ignoreTopics.length ? lists.ignoreTopics.join(', ') : '(empty)'
  const conflictLines = overlaps.length
    ? overlaps.map((o) => `- CARE “${o.care}” vs SKIP “${o.skip}” (${o.reason})`).join('\n')
    : '(none)'
  return `CURRENT LISTS
CARE ABOUT (${lists.topics.length}/${MAX_CARE_TOPICS}): ${care}
DO NOT CARE ABOUT (${lists.ignoreTopics.length}/${MAX_SKIP_TOPICS}): ${skip}
OVERLAPS THAT MUST BE RESOLVED BEFORE FINISHING:
${conflictLines}`
}

export function guideSystemPrompt(): string {
  const profile = formatUserProfileContext(getUserProfile())
  return profile ? `${SYSTEM}\n\n${profile}` : SYSTEM
}

export async function runGuideTurn(opts: {
  history: ChatTurn[]
  lists: GuideLists
  userText: string
  signal?: AbortSignal
}): Promise<{ turn: GuideModelTurn; assistantRaw: string }> {
  const cfg = getOllamaConfig()
  if (!cfg.model) throw new Error('Pick an Ollama model in Settings.')
  const overlaps = findTopicOverlaps(opts.lists.topics, opts.lists.ignoreTopics)
  const user = `${formatGuideLists(opts.lists, overlaps)}

USER:
${opts.userText.trim() || 'Start the interview. Ask the first question. Do not add topics yet.'}`
  const messages: ChatTurn[] = [
    { role: 'system', content: guideSystemPrompt() },
    ...opts.history,
    { role: 'user', content: user },
  ]
  const assistantRaw = await completeOllamaChat({
    messages,
    signal: opts.signal,
    model: cfg.model,
    temperature: 0.4,
    numPredict: 700,
  })
  return { turn: parseGuideTurn(assistantRaw), assistantRaw }
}
