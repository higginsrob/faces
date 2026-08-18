import { getTtsConfig } from './ttsStore'

export type OmniVoice = {
  id: string
  name?: string
  instruct?: string
}

function serviceRoot(host: string): string {
  const trimmed = host.replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) return trimmed.slice(0, -3) || trimmed
  return trimmed
}

function v1Base(host: string): string {
  const root = serviceRoot(host)
  return `${root}/v1`
}

function unwrapFastApiDetail(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return parsed.detail.trim()
    }
  } catch {
    // keep the raw body
  }
  return trimmed
}

function mapOmniMessage(raw: string): string {
  const msg = unwrapFastApiDetail(raw)
  if (/zero-size array|reduction operation (?:maximum|minimum)/i.test(msg)) {
    return 'OmniVoice could not speak that line — it was too short or silent.'
  }
  return msg
}

export function friendlyOmniError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    e instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed|err_connection/i.test(
      msg,
    )
  ) {
    return 'OmniVoice unreachable — is it running on this host?'
  }
  return mapOmniMessage(msg)
}

export async function testOmniVoice(
  host = getTtsConfig().omniHost,
): Promise<{ ok: boolean; detail: string }> {
  const root = serviceRoot(host)
  try {
    const res = await fetch(`${root}/health`)
    if (res.ok) {
      const data = (await res.json()) as {
        device?: string
        modelLoaded?: boolean
      }
      return {
        ok: true,
        detail: `OK · device=${data.device ?? '?'} · loaded=${String(data.modelLoaded)}`,
      }
    }
    const modelsRes = await fetch(`${v1Base(host)}/models`)
    if (!modelsRes.ok) {
      return {
        ok: false,
        detail: `HTTP ${res.status} (health) / ${modelsRes.status} (models)`,
      }
    }
    return { ok: true, detail: 'OK · /v1/models' }
  } catch (e) {
    return { ok: false, detail: friendlyOmniError(e) }
  }
}

export async function listOmniVoices(
  host = getTtsConfig().omniHost,
): Promise<OmniVoice[]> {
  const res = await fetch(`${serviceRoot(host)}/v1/voices`)
  if (!res.ok) throw new Error(`List voices failed: HTTP ${res.status}`)
  const data = (await res.json()) as {
    data?: OmniVoice[]
    presets?: OmniVoice[]
    voices?: OmniVoice[]
  }
  const raw = data.presets ?? data.data ?? data.voices ?? []
  return raw
    .map((v) => ({
      id: String(v.id ?? '').trim(),
      name: typeof v.name === 'string' ? v.name : undefined,
      instruct: typeof v.instruct === 'string' ? v.instruct : undefined,
    }))
    .filter((v) => v.id)
}

let activeAudio: HTMLAudioElement | null = null
let omniPlaying = false

export function isOmniPlaying(): boolean {
  return omniPlaying && !!activeAudio && !activeAudio.paused
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException('Aborted', 'AbortError')
}

function hardStopAudio(audio: HTMLAudioElement): void {
  try {
    audio.pause()
  } catch {
    // ignore
  }
  audio.removeAttribute('src')
  audio.src = ''
  try {
    audio.load()
  } catch {
    // ignore
  }
}

export function stopOmniPlayback(): void {
  omniPlaying = false
  const audio = activeAudio
  activeAudio = null
  if (!audio) return
  hardStopAudio(audio)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function fetchOmniSpeech(opts: {
  text: string
  instruct?: string | null
  refAudio?: Blob | null
  refText?: string | null
  signal?: AbortSignal
}): Promise<Blob> {
  throwIfAborted(opts.signal)
  const cfg = getTtsConfig()
  const body: Record<string, unknown> = {
    model: cfg.omniModel,
    input: opts.text,
    voice: cfg.omniVoice.trim() || 'auto',
    response_format: 'wav',
  }
  const instruct = opts.instruct?.trim()
  if (instruct) body.instruct = instruct
  if (opts.refAudio && opts.refAudio.size > 0) {
    body.ref_audio_b64 = await blobToBase64(opts.refAudio)
    throwIfAborted(opts.signal)
    if (opts.refText?.trim()) body.ref_text = opts.refText.trim()
  }
  const res = await fetch(`${v1Base(cfg.omniHost)}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  throwIfAborted(opts.signal)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      friendlyOmniError(new Error(text || `Speech failed: HTTP ${res.status}`)),
    )
  }
  const buf = await res.arrayBuffer()
  throwIfAborted(opts.signal)
  return new Blob([buf], { type: 'audio/wav' })
}

export function playWavBlob(
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stopOmniPlayback()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    activeAudio = audio
    let settled = false

    const settle = (err?: Error) => {
      if (settled) return
      settled = true
      omniPlaying = false
      signal?.removeEventListener('abort', onAbort)
      if (activeAudio === audio) activeAudio = null
      URL.revokeObjectURL(url)
      if (err) reject(err)
      else resolve()
    }

    const onAbort = () => {
      hardStopAudio(audio)
      settle()
    }

    if (signal?.aborted) {
      hardStopAudio(audio)
      settle()
      return
    }
    signal?.addEventListener('abort', onAbort)
    audio.onplaying = () => {
      if (!settled && activeAudio === audio) omniPlaying = true
    }
    audio.onended = () => settle()
    audio.onerror = () => {
      if (signal?.aborted || settled) {
        settle()
        return
      }
      settle(new Error('OmniVoice playback failed'))
    }
    void audio
      .play()
      .then(() => {
        if (signal?.aborted || activeAudio !== audio) {
          hardStopAudio(audio)
          settle()
        }
      })
      .catch((e) => {
        if (signal?.aborted || settled) {
          settle()
          return
        }
        settle(e instanceof Error ? e : new Error(String(e)))
      })
  })
}
