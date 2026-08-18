/** Ollama generate/Modelfile options sent in `options`. */
export type OllamaOptions = {
  temperature: number
  top_k: number
  top_p: number
  min_p: number
  typical_p: number
  seed: number
  num_predict: number
  num_keep: number
  repeat_penalty: number
  repeat_last_n: number
  presence_penalty: number
  frequency_penalty: number
  penalize_newline: boolean
  stop: string[]
  mirostat: number
  mirostat_tau: number
  mirostat_eta: number
  num_ctx: number
  num_batch: number
  num_gpu: number
  main_gpu: number
  num_thread: number
  numa: boolean
  use_mmap: boolean
  use_mlock: boolean
}

/** Ollama `/api/chat` `think` levels. `medium` is also “on” for models without effort. */
export type OllamaThink = 'off' | 'low' | 'medium' | 'high'

export type OllamaConfig = {
  host: string
  model: string
  keep_alive: string | number
  think: OllamaThink
  options: OllamaOptions
}

export type OllamaTag = {
  name: string
  size?: number
}

/** Optional second model used only to score the news pool. Shares the chat host. */
export type RerankConfig = {
  model: string
  keep_alive: string | number
}
