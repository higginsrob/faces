type SpeechRecognitionCtor = new () => WebSpeechRecognition

interface WebSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: WebSpeechRecognitionEvent) => void) | null
  onerror: ((ev: WebSpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

interface WebSpeechRecognitionEvent extends Event {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      [index: number]: { transcript: string }
    }
  }
}

interface WebSpeechRecognitionErrorEvent extends Event {
  error: string
}

export type BrowserSttListener = {
  onTranscript: (finalText: string, interim: string) => void
  onError: (message: string) => void
  onEnd: () => void
}

export type BrowserStt = {
  start: () => boolean
  stop: () => void
  abort: () => void
  dispose: () => void
}

const ANDROID_RESTART_MS = 280
const DESKTOP_RESTART_MS = 60

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function isAndroidBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

function joinUtterance(left: string, right: string): string {
  const a = left.trim()
  const b = right.trim()
  if (!a) return b
  if (!b) return a
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  if (aLower === bLower || aLower.endsWith(bLower)) return a
  if (bLower.startsWith(aLower)) return b

  const aWords = a.split(/\s+/)
  const bWords = b.split(/\s+/)
  const max = Math.min(aWords.length, bWords.length)
  for (let n = max; n > 0; n--) {
    if (
      aWords.slice(-n).join(' ').toLowerCase() ===
      bWords.slice(0, n).join(' ').toLowerCase()
    ) {
      return [...aWords, ...bWords.slice(n)].join(' ')
    }
  }
  return `${a} ${b}`
}

function leftoverInterim(finalText: string, interim: string): string {
  const f = finalText.trim()
  const i = interim.trim()
  if (!i) return ''
  if (!f) return i
  const fLower = f.toLowerCase()
  const iLower = i.toLowerCase()
  if (fLower === iLower || fLower.endsWith(iLower)) return ''
  if (iLower.startsWith(fLower)) return i.slice(f.length).trim()

  const fWords = f.split(/\s+/)
  const iWords = i.split(/\s+/)
  const max = Math.min(fWords.length, iWords.length)
  for (let n = max; n > 0; n--) {
    if (
      fWords.slice(-n).join(' ').toLowerCase() ===
      iWords.slice(0, n).join(' ').toLowerCase()
    ) {
      return iWords.slice(n).join(' ')
    }
  }
  return i
}

function sessionTranscript(event: WebSpeechRecognitionEvent): {
  finalText: string
  interim: string
} {
  let finalText = ''
  let interim = ''
  for (let i = 0; i < event.results.length; i++) {
    const piece = event.results[i]?.[0]?.transcript ?? ''
    if (event.results[i]?.isFinal) {
      finalText = joinUtterance(finalText, piece)
    } else {
      interim = joinUtterance(interim, piece)
    }
  }
  return { finalText, interim }
}

function friendlySttError(code: string): string | null {
  switch (code) {
    case 'aborted':
    case 'no-speech':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission is needed to talk.'
    case 'audio-capture':
      return "Couldn't reach the microphone."
    case 'network':
      return 'Speech recognition lost its connection.'
    case 'language-not-supported':
      return "This language isn't available for speech to text."
    default:
      return 'Speech recognition failed. Try again.'
  }
}

export function createBrowserStt(listener: BrowserSttListener): BrowserStt {
  const Ctor = getSpeechRecognitionCtor()
  const android = isAndroidBrowser()
  let rec: WebSpeechRecognition | null = null
  let active = false
  let ignoreEnd = false
  let committed = ''
  let finalText = ''
  let interim = ''
  let lastEmitted = ''
  let restartTimer: number | null = null

  const clearRestart = () => {
    if (restartTimer == null) return
    window.clearTimeout(restartTimer)
    restartTimer = null
  }

  const emitTranscript = () => {
    const nextInterim = leftoverInterim(finalText, interim)
    const key = `${finalText}\0${nextInterim}`
    if (key === lastEmitted) return
    lastEmitted = key
    listener.onTranscript(finalText, nextInterim)
  }

  const resetBuffer = () => {
    committed = ''
    finalText = ''
    interim = ''
    lastEmitted = ''
  }

  const unbind = (instance: WebSpeechRecognition) => {
    instance.onresult = null
    instance.onerror = null
    instance.onend = null
  }

  const bind = (instance: WebSpeechRecognition): WebSpeechRecognition => {
    // Android Chrome ignores or mishandles continuous mode: it re-emits the same
    // finals in a loop. One-shot + restart while the user is still listening.
    instance.continuous = !android
    instance.interimResults = true
    instance.maxAlternatives = 1
    instance.lang =
      typeof navigator !== 'undefined' && navigator.language
        ? navigator.language
        : 'en-US'

    instance.onresult = (event) => {
      const session = sessionTranscript(event)
      finalText = joinUtterance(committed, session.finalText)
      interim = session.interim
      emitTranscript()
    }

    instance.onerror = (event) => {
      const msg = friendlySttError(event.error)
      if (event.error === 'no-speech') return
      if (event.error === 'aborted') return
      active = false
      if (msg) listener.onError(msg)
    }

    instance.onend = () => {
      if (ignoreEnd) {
        ignoreEnd = false
        resetBuffer()
        return
      }
      if (active) {
        committed = joinUtterance(finalText, interim)
        finalText = committed
        interim = ''
        emitTranscript()
        clearRestart()
        restartTimer = window.setTimeout(() => {
          restartTimer = null
          if (!active) return
          try {
            const next = android ? freshRecognizer(false) : rec
            if (!next) {
              active = false
              listener.onEnd()
              return
            }
            rec = next
            next.start()
          } catch {
            active = false
            listener.onEnd()
          }
        }, android ? ANDROID_RESTART_MS : DESKTOP_RESTART_MS)
        return
      }
      finalText = joinUtterance(finalText, interim)
      interim = ''
      emitTranscript()
      listener.onEnd()
      resetBuffer()
    }

    return instance
  }

  const freshRecognizer = (abortOld: boolean): WebSpeechRecognition | null => {
    if (!Ctor) return null
    if (rec) {
      unbind(rec)
      if (abortOld) {
        try {
          rec.abort()
        } catch {
          /* already stopped */
        }
      }
    }
    rec = bind(new Ctor())
    return rec
  }

  const ensure = (): WebSpeechRecognition | null => {
    if (!Ctor) return null
    if (!rec) rec = bind(new Ctor())
    return rec
  }

  return {
    start() {
      if (!Ctor) {
        listener.onError("Speech to text isn't supported in this browser.")
        return false
      }
      clearRestart()
      ignoreEnd = false
      active = true
      resetBuffer()
      emitTranscript()
      try {
        const instance = android ? freshRecognizer(true) : ensure()
        if (!instance) return false
        instance.start()
        return true
      } catch (e) {
        if (e instanceof DOMException && e.name === 'InvalidStateError') {
          return true
        }
        active = false
        listener.onError("Couldn't start speech recognition.")
        return false
      }
    },
    stop() {
      clearRestart()
      if (!active) return
      active = false
      try {
        rec?.stop()
      } catch {
        listener.onEnd()
        resetBuffer()
      }
    },
    abort() {
      ignoreEnd = true
      active = false
      clearRestart()
      resetBuffer()
      try {
        rec?.abort()
      } catch {
        /* already stopped */
      }
    },
    dispose() {
      ignoreEnd = true
      active = false
      clearRestart()
      if (rec) {
        unbind(rec)
        try {
          rec.abort()
        } catch {
          /* already stopped */
        }
      }
      rec = null
      resetBuffer()
    },
  }
}
