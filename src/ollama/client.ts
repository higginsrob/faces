import {
  ollamaKeepAlivePayload,
  ollamaOptionsPayload,
  ollamaThinkPayload,
} from './defaults'
import { getOllamaConfig } from './store'
import type { OllamaTag } from './types'

export type ChatTurn = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatUsage = {
  model?: string
  promptTokens: number
  completionTokens: number
  totalDurationNs?: number
  loadDurationNs?: number
  promptEvalDurationNs?: number
  evalDurationNs?: number
}

export type OllamaModelMeta = {
  name: string
  family?: string
  parameterSize?: string
  quantization?: string
  format?: string
  parameterCount?: number
  contextLength?: number
  capabilities: string[]
}

type ChatChunk = {
  message?: { content?: string; thinking?: string }
  error?: string
  done?: boolean
  model?: string
  prompt_eval_count?: number
  eval_count?: number
  total_duration?: number
  load_duration?: number
  prompt_eval_duration?: number
  eval_duration?: number
}

export function friendlyOllamaError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    e instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed|err_connection|not allowed/i.test(
      msg,
    )
  ) {
    return 'Cannot reach Ollama. Is it running, and is OLLAMA_ORIGINS set for this site?'
  }
  return msg
}

export async function listOllamaTags(
  host = getOllamaConfig().host,
): Promise<OllamaTag[]> {
  const base = host.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/tags`)
  if (!res.ok) throw new Error(`Ollama tags failed: HTTP ${res.status}`)
  const data = (await res.json()) as {
    models?: { name?: string; model?: string; size?: number }[]
  }
  const models = Array.isArray(data.models) ? data.models : []
  return models
    .map((m) => ({
      name: String(m.name ?? m.model ?? '').trim(),
      size: typeof m.size === 'number' ? m.size : undefined,
    }))
    .filter((m) => m.name)
}

export async function showOllamaModel(
  model = getOllamaConfig().model,
  host = getOllamaConfig().host,
): Promise<OllamaModelMeta> {
  const name = model.trim()
  if (!name) throw new Error('Pick an Ollama model in Settings.')
  const base = host.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Ollama show failed: HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    details?: {
      family?: string
      parameter_size?: string
      quantization_level?: string
      format?: string
    }
    model_info?: Record<string, unknown>
    capabilities?: unknown
  }
  const details = data.details ?? {}
  const info =
    data.model_info && typeof data.model_info === 'object'
      ? data.model_info
      : {}
  const capabilities = Array.isArray(data.capabilities)
    ? data.capabilities.filter((c): c is string => typeof c === 'string')
    : []
  return {
    name,
    family: strOrUndef(details.family),
    parameterSize: strOrUndef(details.parameter_size),
    quantization: strOrUndef(details.quantization_level),
    format: strOrUndef(details.format),
    parameterCount: numFromInfo(info, 'general.parameter_count'),
    contextLength: numFromInfoSuffix(info, '.context_length'),
    capabilities,
  }
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function numFromInfo(
  info: Record<string, unknown>,
  key: string,
): number | undefined {
  return asFiniteNumber(info[key])
}

function numFromInfoSuffix(
  info: Record<string, unknown>,
  suffix: string,
): number | undefined {
  const exact = asFiniteNumber(info[suffix.slice(1)])
  if (exact != null) return exact
  for (const [k, v] of Object.entries(info)) {
    if (k.endsWith(suffix)) {
      const n = asFiniteNumber(v)
      if (n != null) return n
    }
  }
  return undefined
}

export async function testOllamaHost(
  host = getOllamaConfig().host,
): Promise<{ ok: boolean; detail: string; tags: OllamaTag[] }> {
  try {
    const tags = await listOllamaTags(host)
    const names = tags.map((t) => t.name).slice(0, 6).join(', ')
    return {
      ok: true,
      detail: tags.length
        ? `OK · ${tags.length} model${tags.length === 1 ? '' : 's'}${names ? ` (${names})` : ''}`
        : 'OK · no models pulled yet',
      tags,
    }
  } catch (e) {
    return { ok: false, detail: friendlyOllamaError(e), tags: [] }
  }
}

function applyChatChunk(
  parsed: ChatChunk,
  onDelta: (text: string) => void,
  onUsage?: (usage: ChatUsage) => void,
  onThinkDelta?: (text: string) => void,
): string {
  if (parsed.error) throw new Error(parsed.error)
  if (parsed.done) {
    const prompt = parsed.prompt_eval_count
    const completion = parsed.eval_count
    const hasTokens =
      typeof prompt === 'number' || typeof completion === 'number'
    const hasTiming =
      typeof parsed.total_duration === 'number' ||
      typeof parsed.eval_duration === 'number'
    if (hasTokens || hasTiming) {
      onUsage?.({
        model: strOrUndef(parsed.model),
        promptTokens: typeof prompt === 'number' ? prompt : 0,
        completionTokens: typeof completion === 'number' ? completion : 0,
        totalDurationNs: asFiniteNumber(parsed.total_duration),
        loadDurationNs: asFiniteNumber(parsed.load_duration),
        promptEvalDurationNs: asFiniteNumber(parsed.prompt_eval_duration),
        evalDurationNs: asFiniteNumber(parsed.eval_duration),
      })
    }
  }
  const thinking = parsed.message?.thinking
  if (typeof thinking === 'string' && thinking) {
    onThinkDelta?.(thinking)
  }
  const piece = parsed.message?.content
  if (typeof piece === 'string' && piece) {
    onDelta(piece)
    return piece
  }
  return ''
}

export async function streamOllamaChat(opts: {
  messages: ChatTurn[]
  signal?: AbortSignal
  onDelta: (text: string) => void
  onThinkDelta?: (text: string) => void
  onUsage?: (usage: ChatUsage) => void
}): Promise<string> {
  const cfg = getOllamaConfig()
  if (!cfg.model) throw new Error('Pick an Ollama model in Settings.')
  const base = cfg.host.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      keep_alive: ollamaKeepAlivePayload(cfg.keep_alive),
      think: ollamaThinkPayload(cfg.think),
      messages: opts.messages,
      options: ollamaOptionsPayload(cfg.options),
    }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Ollama chat failed: HTTP ${res.status}`)
  }
  if (!res.body) throw new Error('Ollama returned an empty body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: ChatChunk
      try {
        parsed = JSON.parse(trimmed) as ChatChunk
      } catch {
        continue
      }
      full += applyChatChunk(
        parsed,
        opts.onDelta,
        opts.onUsage,
        opts.onThinkDelta,
      )
    }
  }

  if (buf.trim()) {
    try {
      const parsed = JSON.parse(buf.trim()) as ChatChunk
      full += applyChatChunk(
        parsed,
        opts.onDelta,
        opts.onUsage,
        opts.onThinkDelta,
      )
    } catch (e) {
      if (e instanceof SyntaxError) {
        // leftover non-JSON is fine
      } else {
        throw e
      }
    }
  }

  return full
}

export async function completeOllamaChat(opts: {
  messages: ChatTurn[]
  signal?: AbortSignal
  numPredict?: number
  model?: string
  keepAlive?: string | number
  temperature?: number
}): Promise<string> {
  const cfg = getOllamaConfig()
  const model = (opts.model ?? cfg.model).trim()
  if (!model) throw new Error('Pick an Ollama model in Settings.')
  const base = cfg.host.replace(/\/+$/, '')
  const options = opts.model
    ? {
        temperature: opts.temperature ?? 0,
        ...(opts.numPredict != null ? { num_predict: opts.numPredict } : {}),
      }
    : ollamaOptionsPayload(cfg.options)
  if (!opts.model && opts.numPredict != null) options.num_predict = opts.numPredict
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: ollamaKeepAlivePayload(opts.keepAlive ?? cfg.keep_alive),
      think: false,
      messages: opts.messages,
      options,
    }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Ollama chat failed: HTTP ${res.status}`)
  }
  const data = (await res.json()) as ChatChunk
  if (data.error) throw new Error(data.error)
  const content = data.message?.content
  return typeof content === 'string' ? content : ''
}
