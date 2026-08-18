import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  AUTO_SPEAKER,
  clearChat,
  lockSpeaker,
  sendUserMessage,
  setError,
  setNewsOpen,
  setSettingsOpen,
  setSpeakerAuto,
  setUsageOpen,
  useSession,
} from '../chat/session'
import { useOllamaConfig } from '../ollama/store'
import { usePersonas } from '../personas/store'
import { createBrowserStt } from '../voice/browserStt'
import { warmBrowserTtsVoices } from '../voice/browserTts'
import { stopTts } from '../voice/tts'
import { useWebConfig } from '../web/store'
import { ContextMeter, estimateTokens } from './ContextMeter'

const MOBILE_QUERY =
  '(max-width: 640px), ((hover: none) and (pointer: coarse))'
const HOLD_MS = 240

function subscribeMobile(cb: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

function getMobileSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches
}

function useMobileView(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false)
}

function TalkButton({
  disabled,
  onUtterance,
  onLive,
}: {
  disabled: boolean
  onUtterance: (text: string) => void
  onLive: (text: string | null) => void
}) {
  const [listening, setListening] = useState(false)
  const listeningRef = useRef(false)
  const liveRef = useRef('')
  const sttRef = useRef<ReturnType<typeof createBrowserStt> | null>(null)
  const onUtteranceRef = useRef(onUtterance)
  const onLiveRef = useRef(onLive)
  const gestureRef = useRef<'idle' | 'down' | 'hold'>('idle')
  const startedThisPressRef = useRef(false)
  const holdTimerRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const finishPressRef = useRef<(e: PointerEvent) => void>(() => {})
  const windowEndRef = useRef((e: PointerEvent) => {
    finishPressRef.current(e)
  })

  onUtteranceRef.current = onUtterance
  onLiveRef.current = onLive

  useEffect(() => {
    const stt = createBrowserStt({
      onTranscript: (finalText, interim) => {
        const next = [finalText, interim].filter(Boolean).join(' ').trim()
        liveRef.current = next
        onLiveRef.current(next)
      },
      onError: (message) => {
        setError(message)
        liveRef.current = ''
        onLiveRef.current(null)
        listeningRef.current = false
        setListening(false)
      },
      onEnd: () => {
        const text = liveRef.current.trim()
        liveRef.current = ''
        onLiveRef.current(null)
        listeningRef.current = false
        setListening(false)
        if (text) onUtteranceRef.current(text)
      },
    })
    sttRef.current = stt
    return () => {
      window.removeEventListener('pointerup', windowEndRef.current)
      window.removeEventListener('pointercancel', windowEndRef.current)
      stt.dispose()
      sttRef.current = null
    }
  }, [])

  const clearHoldTimer = () => {
    if (holdTimerRef.current == null) return
    window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
  }

  const detachPress = () => {
    window.removeEventListener('pointerup', windowEndRef.current)
    window.removeEventListener('pointercancel', windowEndRef.current)
  }

  const beginListen = () => {
    if (listeningRef.current || disabled) return
    setError(null)
    stopTts()
    const ok = sttRef.current?.start() ?? false
    if (!ok) return
    listeningRef.current = true
    setListening(true)
    liveRef.current = ''
    onLiveRef.current('')
  }

  const endListen = () => {
    if (!listeningRef.current) return
    sttRef.current?.stop()
  }

  const finishPress = (e: PointerEvent) => {
    if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) {
      return
    }
    if (gestureRef.current === 'idle') return
    detachPress()
    clearHoldTimer()
    const gesture = gestureRef.current
    const startedThisPress = startedThisPressRef.current
    gestureRef.current = 'idle'
    startedThisPressRef.current = false
    pointerIdRef.current = null
    if (gesture === 'hold') {
      endListen()
      return
    }
    if (gesture === 'down' && !startedThisPress) {
      endListen()
    }
  }
  finishPressRef.current = finishPress

  useEffect(() => {
    if (!disabled) return
    detachPress()
    clearHoldTimer()
    gestureRef.current = 'idle'
    pointerIdRef.current = null
    liveRef.current = ''
    onLiveRef.current(null)
    listeningRef.current = false
    setListening(false)
    sttRef.current?.abort()
  }, [disabled])

  return (
    <button
      type="button"
      className={`talk-btn${listening ? ' listening' : ''}`}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? 'Stop listening' : 'Talk'}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        if (gestureRef.current !== 'idle') return
        e.preventDefault()
        pointerIdRef.current = e.pointerId
        gestureRef.current = 'down'
        startedThisPressRef.current = false
        if (!listeningRef.current) {
          beginListen()
          startedThisPressRef.current = listeningRef.current
        }
        clearHoldTimer()
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null
          if (gestureRef.current === 'down') gestureRef.current = 'hold'
        }, HOLD_MS)
        window.addEventListener('pointerup', windowEndRef.current)
        window.addEventListener('pointercancel', windowEndRef.current)
      }}
      onClick={(e) => {
        if (e.detail !== 0) return
        if (disabled) return
        if (listeningRef.current) endListen()
        else beginListen()
      }}
    >
      {listening ? 'Listening' : 'Talk'}
    </button>
  )
}

function PersonaSelect() {
  const { speakerMode, viewMode } = useSession()
  const { personas, activeId } = usePersonas()
  const active = personas.find((p) => p.id === activeId) ?? personas[0]!
  const autoLabel =
    speakerMode === 'auto' && viewMode === 'focused'
      ? `Auto · ${active.defaultFace} ${active.name}`
      : 'Auto'

  return (
    <select
      className="persona-select"
      aria-label="Persona"
      title="Persona"
      value={speakerMode === 'auto' ? AUTO_SPEAKER : activeId}
      onChange={(e) => {
        const id = e.target.value
        if (id === AUTO_SPEAKER) setSpeakerAuto()
        else lockSpeaker(id)
      }}
    >
      <option value={AUTO_SPEAKER}>{autoLabel}</option>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.defaultFace} {p.name}
        </option>
      ))}
    </select>
  )
}

export function TalkBar() {
  const { streaming, settingsOpen, newsOpen, messages, usedTokens, usageOpen } =
    useSession()
  const ollama = useOllamaConfig()
  const web = useWebConfig()
  const mobile = useMobileView()
  const [draft, setDraft] = useState('')
  const [sttLive, setSttLive] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wasStreaming = useRef(streaming)

  useEffect(() => {
    warmBrowserTtsVoices()
  }, [])

  useEffect(() => {
    if (wasStreaming.current && !streaming && !settingsOpen && !mobile) {
      inputRef.current?.focus()
    }
    wasStreaming.current = streaming
  }, [streaming, settingsOpen, mobile])

  const submit = (text: string) => {
    const t = text.trim()
    if (!t) return
    setDraft('')
    void sendUserMessage(t)
  }

  const draftTokens = estimateTokens(draft)
  const used =
    usedTokens > 0
      ? usedTokens + draftTokens
      : messages.reduce((n, m) => n + estimateTokens(m.content), 0) +
        draftTokens

  const sttHover =
    sttLive != null ? (
      <div className="talk-live" aria-live="polite">
        {sttLive || 'Speak now'}
      </div>
    ) : null

  return (
    <div className="talk-bar">
      <form
        className="text-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!mobile) submit(draft)
        }}
      >
        <PersonaSelect />
        {mobile ? (
          <div className="text-input-wrap">
            {sttHover}
            <TalkButton
              disabled={settingsOpen}
              onUtterance={submit}
              onLive={setSttLive}
            />
          </div>
        ) : (
          <>
            <div className="text-input-wrap">
              {sttHover}
              <input
                ref={inputRef}
                className="text-input"
                type="text"
                value={draft}
                placeholder="Type a message"
                autoComplete="off"
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <button type="submit" className="send-btn" disabled={!draft.trim()}>
              Send
            </button>
            <TalkButton
              disabled={settingsOpen}
              onUtterance={submit}
              onLive={setSttLive}
            />
          </>
        )}
        <ContextMeter
          used={used}
          limit={ollama.options.num_ctx}
          expanded={usageOpen}
          onClick={() => setUsageOpen(true)}
        />
        <button
          type="button"
          className="icon-btn reset"
          title="Reset"
          aria-label="Reset chat history"
          disabled={messages.length === 0}
          onClick={() => clearChat()}
        >
          <svg
            className="reset-icon"
            viewBox="0 0 24 24"
            width="28"
            height="28"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v10h-2V9Zm4 0h2v10h-2V9ZM6 7h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Z"
            />
          </svg>
        </button>
        {web.enabled ? (
          <button
            type="button"
            className="icon-btn news"
            title="News"
            aria-label="News"
            aria-expanded={newsOpen}
            onClick={() => setNewsOpen(!newsOpen)}
          >
            <svg
              className="news-icon"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M5 4h13a2 2 0 0 1 2 2v13a1.5 1.5 0 0 1-1.5 1.5H6.5A2.5 2.5 0 0 1 4 18V6.5A2.5 2.5 0 0 1 6.5 4H5Zm3 0v16h11.5a.5.5 0 0 0 .5-.5V6a1 1 0 0 0-1-1H8Zm2 4h8v2h-8V8Zm0 4h8v2h-8v-2Zm0 4h5v2h-5v-2Z"
              />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn gear"
          title="Settings"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <svg
            className="gear-icon"
            viewBox="0 0 24 24"
            width="28"
            height="28"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.5.42l-.36 2.54c-.6.24-1.15.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.8 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.92 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.48.39 1.03.7 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.8a.5.5 0 0 0 .5-.42l.36-2.54c.6-.24 1.15-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
            />
          </svg>
        </button>
      </form>
    </div>
  )
}
