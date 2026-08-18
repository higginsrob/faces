import type { Persona } from '../personas/types'
import { isBrowserTtsSpeaking, resetBrowserTts, speakBrowserSentence } from './browserTts'
import {
  fetchOmniSpeech,
  friendlyOmniError,
  isOmniPlaying,
  playWavBlob,
  stopOmniPlayback,
} from './omniVoice'
import {
  hasSpeakableContent,
  speakableCharCount,
  stripForSpeech,
} from './spokenText'
import { composeVoiceInstruct, getTtsConfig } from './ttsStore'

/** OmniVoice silence-strips tiny clips to empty audio, then crashes. */
const OMNI_MIN_SPEAKABLE = 12
const OMNI_MIN_REF_BYTES = 24_000

let queue: string[] = []
let pending = ''
let pumping = false
let pumpGen = 0
let abort: AbortController | null = null
let firstWav: Blob | null = null
let firstText: string | null = null
let onError: ((msg: string) => void) | null = null
let onStart: (() => void) | null = null
let onIdle: (() => void) | null = null
let speakerId: string | null = null
let speakerInstruct: string | null = null

export function setTtsSpeaker(persona: Persona | null): void {
  const nextId = persona?.id ?? null
  const next = persona ? composeVoiceInstruct(persona) : null
  if (nextId !== speakerId) {
    firstWav = null
    firstText = null
  }
  speakerId = nextId
  speakerInstruct = next
}

export function setTtsErrorHandler(fn: ((msg: string) => void) | null): void {
  onError = fn
}

export function setTtsPlaybackHandlers(
  handlers: { onStart?: () => void; onIdle?: () => void } | null,
): void {
  onStart = handlers?.onStart ?? null
  onIdle = handlers?.onIdle ?? null
}

export function isTtsBusy(): boolean {
  return pumping || queue.length > 0 || pending.length > 0
}

export function isTtsPlaying(): boolean {
  return isOmniPlaying() || isBrowserTtsSpeaking()
}

export function stopTts(): void {
  pumpGen += 1
  queue = []
  pending = ''
  pumping = false
  firstWav = null
  firstText = null
  abort?.abort()
  abort = null
  stopOmniPlayback()
  resetBrowserTts()
}

function takeForQueue(text: string, flushPending: boolean): void {
  const cleaned = stripForSpeech(text)
  if (cleaned && hasSpeakableContent(cleaned)) {
    pending = pending ? `${pending} ${cleaned}` : cleaned
  }
  if (!pending) return
  const engine = getTtsConfig().engine
  if (
    engine !== 'omnivoice' ||
    flushPending ||
    speakableCharCount(pending) >= OMNI_MIN_SPEAKABLE
  ) {
    queue.push(pending)
    pending = ''
  }
}

export function enqueueSpeak(text: string): void {
  const cfg = getTtsConfig()
  if (!cfg.enabled) return
  const queued = queue.length
  takeForQueue(text, false)
  if (queue.length === queued && !pending) return
  onStart?.()
  if (queue.length > queued) void pump()
}

export function flushSpeak(text: string): void {
  const cfg = getTtsConfig()
  if (!cfg.enabled) return
  takeForQueue(text, true)
  if (queue.length === 0) return
  onStart?.()
  void pump()
}

async function pump(): Promise<void> {
  if (pumping) return
  const myGen = pumpGen
  pumping = true
  abort = new AbortController()
  const signal = abort.signal
  const engine = getTtsConfig().engine
  let failed = false

  try {
    while (queue.length && !signal.aborted && myGen === pumpGen) {
      const sentence = queue.shift()!
      if (engine === 'omnivoice') {
        const wav = await fetchOmniSpeech({
          text: sentence,
          instruct: speakerInstruct,
          refAudio: firstWav,
          refText: firstText,
          signal,
        })
        if (myGen !== pumpGen || signal.aborted) return
        if (!firstWav && wav.size >= OMNI_MIN_REF_BYTES) {
          firstWav = wav
          firstText = sentence
        }
        await playWavBlob(wav, signal)
      } else {
        await speakBrowserSentence(sentence, signal)
      }
    }
  } catch (e) {
    if (myGen !== pumpGen || signal.aborted) return
    failed = true
    queue = []
    pending = ''
    onError?.(friendlyOmniError(e))
  } finally {
    if (myGen === pumpGen) {
      pumping = false
      if (!failed && !signal.aborted && queue.length === 0) {
        onIdle?.()
      }
    }
  }
}
