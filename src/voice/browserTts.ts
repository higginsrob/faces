import { getTtsConfig } from './ttsStore'

let keepAliveTimer: number | null = null
let speakGen = 0
let utteranceSpeaking = false

export function isNetworkVoice(voice: SpeechSynthesisVoice): boolean {
  return !voice.localService || /^google\b/i.test(voice.name)
}

export function isGoogleVoice(voice: SpeechSynthesisVoice): boolean {
  return /^google\b/i.test(voice.name)
}

export function listBrowserTtsVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return []
  return window.speechSynthesis.getVoices()
}

export function listUsableBrowserTtsVoices(
  voices: SpeechSynthesisVoice[] = listBrowserTtsVoices(),
): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => {
    const aGoogle = isGoogleVoice(a) ? 0 : 1
    const bGoogle = isGoogleVoice(b) ? 0 : 1
    if (aGoogle !== bGoogle) return aGoogle - bGoogle
    const aEn = /^en(-|_)/i.test(a.lang) ? 0 : 1
    const bEn = /^en(-|_)/i.test(b.lang) ? 0 : 1
    if (aEn !== bEn) return aEn - bEn
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function pickBrowserTtsVoice(
  voiceURI: string | null = getTtsConfig().browserVoiceURI,
): SpeechSynthesisVoice | null {
  const voices = listBrowserTtsVoices()
  if (voices.length === 0) return null
  const locals = voices.filter((v) => !isNetworkVoice(v))
  const localEn = locals.filter((v) => /^en(-|_)/i.test(v.lang))
  if (voiceURI) {
    const match = voices.find((v) => v.voiceURI === voiceURI)
    if (match) return match
  }
  return (
    localEn[0] ??
    locals[0] ??
    voices.find((v) => /^en(-|_)/i.test(v.lang)) ??
    voices[0] ??
    null
  )
}

function stopKeepAlive(): void {
  if (keepAliveTimer != null) {
    window.clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
}

function startKeepAlive(synth: SpeechSynthesis): void {
  stopKeepAlive()
  keepAliveTimer = window.setInterval(() => {
    try {
      if (!synth.speaking) {
        stopKeepAlive()
        return
      }
      synth.pause()
      synth.resume()
    } catch {
      stopKeepAlive()
    }
  }, 12_000)
}

export function isBrowserTtsSpeaking(): boolean {
  return utteranceSpeaking
}

export function resetBrowserTts(): void {
  speakGen += 1
  utteranceSpeaking = false
  stopKeepAlive()
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const synth = window.speechSynthesis
  try {
    synth.cancel()
  } catch {
    // ignore
  }
  try {
    synth.resume()
  } catch {
    // ignore
  }
}

export function warmBrowserTtsVoices(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  void window.speechSynthesis.getVoices()
}

export function speakBrowserSentence(
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve()
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    const gen = speakGen
    const voice = pickBrowserTtsVoice()
    const u = new SpeechSynthesisUtterance(trimmed)
    u.rate = 0.95
    u.pitch = 1
    u.volume = 1
    if (voice) {
      u.voice = voice
      u.lang = voice.lang || 'en-US'
    } else {
      u.lang = 'en-US'
    }

    const onAbort = () => {
      utteranceSpeaking = false
      try {
        synth.cancel()
      } catch {
        // ignore
      }
      cleanup()
      resolve()
    }

    const cleanup = () => {
      stopKeepAlive()
      signal?.removeEventListener('abort', onAbort)
    }

    if (signal?.aborted) {
      resolve()
      return
    }
    signal?.addEventListener('abort', onAbort)

    u.onstart = () => {
      if (gen !== speakGen) return
      utteranceSpeaking = true
      startKeepAlive(synth)
      try {
        if (synth.paused) synth.resume()
      } catch {
        // ignore
      }
    }
    u.onend = () => {
      utteranceSpeaking = false
      if (gen !== speakGen) {
        cleanup()
        resolve()
        return
      }
      cleanup()
      resolve()
    }
    u.onerror = (ev) => {
      utteranceSpeaking = false
      cleanup()
      const code =
        typeof SpeechSynthesisErrorEvent !== 'undefined' &&
        ev instanceof SpeechSynthesisErrorEvent
          ? ev.error
          : 'failed'
      if (code === 'interrupted' || code === 'canceled') {
        resolve()
        return
      }
      reject(new Error(`Browser TTS: ${code}`))
    }

    try {
      synth.resume()
    } catch {
      // ignore
    }
    synth.speak(u)
  })
}

export function subscribeVoicesChanged(fn: () => void): () => void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return () => {}
  const synth = window.speechSynthesis
  synth.addEventListener('voiceschanged', fn)
  void synth.getVoices()
  return () => synth.removeEventListener('voiceschanged', fn)
}
