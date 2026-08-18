import type { OllamaConfig, OllamaOptions, OllamaThink } from './types'

export const OLLAMA_THINK_LEVELS: { value: OllamaThink; label: string }[] = [
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium/on' },
  { value: 'high', label: 'high' },
]

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

export function defaultOllamaOptions(): OllamaOptions {
  return {
    temperature: 0.8,
    top_k: 40,
    top_p: 0.9,
    min_p: 0,
    typical_p: 1,
    seed: -1,
    num_predict: -1,
    num_keep: 0,
    repeat_penalty: 1.1,
    repeat_last_n: 64,
    presence_penalty: 0,
    frequency_penalty: 0,
    penalize_newline: true,
    stop: [],
    mirostat: 0,
    mirostat_tau: 5,
    mirostat_eta: 0.1,
    num_ctx: 32768,
    num_batch: 512,
    num_gpu: -1,
    main_gpu: 0,
    num_thread: 0,
    numa: false,
    use_mmap: true,
    use_mlock: false,
  }
}

export function defaultOllamaConfig(): OllamaConfig {
  return {
    host: DEFAULT_OLLAMA_HOST,
    model: '',
    keep_alive: '5m',
    think: 'off',
    options: defaultOllamaOptions(),
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function think(v: unknown, fallback: OllamaThink): OllamaThink {
  if (v === 'off' || v === 'low' || v === 'medium' || v === 'high') return v
  return fallback
}

export function normalizeKeepAlive(
  raw: unknown,
  fallback: string | number,
): string | number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < 0) return -1
    if (raw === 0) return 0
    return fallback
  }
  if (typeof raw !== 'string') return fallback
  const s = raw.trim()
  if (!s) return fallback
  if (s === '-1' || /^forever$/i.test(s)) return -1
  if (s === '0') return 0
  return s
}

export function ollamaKeepAlivePayload(value: string | number): string | number {
  if (value === -1 || value === 0) return value
  return String(value)
}

/** Map stored effort to Ollama’s `think` field (`false` or `"low"|"medium"|"high"`). */
export function ollamaThinkPayload(
  value: OllamaThink,
): false | 'low' | 'medium' | 'high' {
  if (value === 'off') return false
  return value
}

export function normalizeOllamaConfig(raw: Partial<OllamaConfig> | null): OllamaConfig {
  const d = defaultOllamaConfig()
  const o: Partial<OllamaOptions> = raw?.options ?? {}
  const stop = Array.isArray(o.stop)
    ? o.stop.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : []
  return {
    host:
      typeof raw?.host === 'string' && raw.host.trim()
        ? raw.host.trim().replace(/\/+$/, '')
        : d.host,
    model: typeof raw?.model === 'string' ? raw.model.trim() : '',
    keep_alive: normalizeKeepAlive(raw?.keep_alive, d.keep_alive),
    think: think(raw?.think, d.think),
    options: {
      temperature: num(o.temperature, d.options.temperature),
      top_k: num(o.top_k, d.options.top_k),
      top_p: num(o.top_p, d.options.top_p),
      min_p: num(o.min_p, d.options.min_p),
      typical_p: num(o.typical_p, d.options.typical_p),
      seed: num(o.seed, d.options.seed),
      num_predict: num(o.num_predict, d.options.num_predict),
      num_keep: num(o.num_keep, d.options.num_keep),
      repeat_penalty: num(o.repeat_penalty, d.options.repeat_penalty),
      repeat_last_n: num(o.repeat_last_n, d.options.repeat_last_n),
      presence_penalty: num(o.presence_penalty, d.options.presence_penalty),
      frequency_penalty: num(o.frequency_penalty, d.options.frequency_penalty),
      penalize_newline: bool(o.penalize_newline, d.options.penalize_newline),
      stop,
      mirostat: num(o.mirostat, d.options.mirostat),
      mirostat_tau: num(o.mirostat_tau, d.options.mirostat_tau),
      mirostat_eta: num(o.mirostat_eta, d.options.mirostat_eta),
      num_ctx: num(o.num_ctx, d.options.num_ctx),
      num_batch: num(o.num_batch, d.options.num_batch),
      num_gpu: num(o.num_gpu, d.options.num_gpu),
      main_gpu: num(o.main_gpu, d.options.main_gpu),
      num_thread: num(o.num_thread, d.options.num_thread),
      numa: bool(o.numa, d.options.numa),
      use_mmap: bool(o.use_mmap, d.options.use_mmap),
      use_mlock: bool(o.use_mlock, d.options.use_mlock),
    },
  }
}

/** Build the `options` object, omitting "use server default" sentinels. */
export function ollamaOptionsPayload(
  options: OllamaOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    temperature: options.temperature,
    top_k: options.top_k,
    top_p: options.top_p,
    min_p: options.min_p,
    typical_p: options.typical_p,
    num_predict: options.num_predict,
    num_keep: options.num_keep,
    repeat_penalty: options.repeat_penalty,
    repeat_last_n: options.repeat_last_n,
    presence_penalty: options.presence_penalty,
    frequency_penalty: options.frequency_penalty,
    penalize_newline: options.penalize_newline,
    mirostat: options.mirostat,
    mirostat_tau: options.mirostat_tau,
    mirostat_eta: options.mirostat_eta,
    num_ctx: options.num_ctx,
    num_batch: options.num_batch,
    main_gpu: options.main_gpu,
    numa: options.numa,
    use_mmap: options.use_mmap,
    use_mlock: options.use_mlock,
  }
  if (options.seed >= 0) out.seed = options.seed
  if (options.num_gpu >= 0) out.num_gpu = options.num_gpu
  if (options.num_thread > 0) out.num_thread = options.num_thread
  if (options.stop.length > 0) out.stop = options.stop
  return out
}
