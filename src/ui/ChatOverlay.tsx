import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { toggleMessageSpeech, useSession } from '../chat/session'
import { getActivePersona, getPersonaById, usePersonas } from '../personas/store'
import { loadJson, saveJson } from '../storage'
import {
  hasSpeakableContent,
  stripForSpeech,
} from '../voice/spokenText'
import { parseNewsLinkLines } from '../web/links'
import { NewsSourceLink } from './NewsSourceLink'
import { PersonaAddressRow } from './PersonaAddressRow'

const AGENT_COL_KEY = 'faces:agent-col-width'
const AGENT_COL_DEFAULT = 520
const USER_COL_KEY = 'faces:user-col-width'
const USER_COL_DEFAULT = 420
const COL_MIN = 280
const COL_MAX = 760
const CHAT_H_KEY = 'faces:chat-overlay-height'
const CHAT_H_DEFAULT = 280
const CHAT_H_MIN = 96
const CHAT_H_RESERVE = 148

type OverlayDrag =
  | { axis: 'agent-x' | 'user-x'; pos: number; start: number }
  | { axis: 'y'; pos: number; start: number }

function colMax(): number {
  if (typeof window === 'undefined') return COL_MAX
  return Math.min(COL_MAX, Math.round(window.innerWidth * 0.72))
}

function clampCol(n: number): number {
  return Math.round(Math.min(colMax(), Math.max(COL_MIN, n)))
}

function loadAgentColWidth(): number {
  const raw = loadJson<unknown>(AGENT_COL_KEY, AGENT_COL_DEFAULT)
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : AGENT_COL_DEFAULT
  return clampCol(n)
}

function loadUserColWidth(): number {
  const raw = loadJson<unknown>(USER_COL_KEY, USER_COL_DEFAULT)
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : USER_COL_DEFAULT
  return clampCol(n)
}

function chatOverlayMax(): number {
  if (typeof window === 'undefined') return 640
  return Math.max(CHAT_H_MIN, Math.round(window.innerHeight - CHAT_H_RESERVE))
}

function clampChatOverlayH(n: number): number {
  return Math.round(Math.min(chatOverlayMax(), Math.max(CHAT_H_MIN, n)))
}

function defaultChatOverlayH(): number {
  if (typeof window === 'undefined') return CHAT_H_DEFAULT
  return clampChatOverlayH(Math.min(CHAT_H_DEFAULT, Math.round(window.innerHeight * 0.34)))
}

function loadChatOverlayH(): number {
  const raw = loadJson<unknown>(CHAT_H_KEY, null)
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : defaultChatOverlayH()
  return clampChatOverlayH(n)
}

function SpeakButton({
  messageId,
  content,
  speaking,
}: {
  messageId: string
  content: string
  speaking: boolean
}) {
  const speakable = hasSpeakableContent(
    stripForSpeech(parseNewsLinkLines(content).text || content),
  )
  if (!speakable) return null
  return (
    <button
      type="button"
      className={`bubble-speak${speaking ? ' on' : ''}`}
      title={speaking ? 'Stop speaking' : 'Replay'}
      aria-label={speaking ? 'Stop speaking' : 'Replay'}
      aria-pressed={speaking}
      onClick={() => toggleMessageSpeech(messageId)}
    >
      {speaking ? (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M6 6h12v12H6z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
          />
        </svg>
      )}
    </button>
  )
}

function AgentColResize({ onPointerDown }: { onPointerDown: (e: PointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      className="agent-col-resize"
      aria-hidden="true"
      title="Drag to resize replies"
      onPointerDown={onPointerDown}
    />
  )
}

function UserColResize({ onPointerDown }: { onPointerDown: (e: PointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      className="user-col-resize"
      aria-hidden="true"
      title="Drag to resize prompts"
      onPointerDown={onPointerDown}
    />
  )
}

function ChatOverlayResize({ onPointerDown }: { onPointerDown: (e: PointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      className="chat-overlay-resize"
      aria-hidden="true"
      title="Drag to resize chat height"
      onPointerDown={onPointerDown}
    />
  )
}

export function ChatOverlay() {
  const {
    messages,
    streaming,
    thinkTokens,
    classifying,
    readingArticle,
    speakingMessageId,
  } = useSession()
  const { personas } = usePersonas()
  const persona = getActivePersona()
  const scroller = useRef<HTMLDivElement>(null)
  const visible = messages.filter((m) => m.role !== 'system')
  const liveId = streaming ? visible.at(-1)?.id : undefined
  const [colWidth, setColWidth] = useState(loadAgentColWidth)
  const [userColWidth, setUserColWidth] = useState(loadUserColWidth)
  const [overlayH, setOverlayH] = useState(loadChatOverlayH)
  const [resizing, setResizing] = useState<'agent-x' | 'user-x' | 'y' | null>(null)
  const drag = useRef<OverlayDrag | null>(null)
  const widthRef = useRef(colWidth)
  const userWidthRef = useRef(userColWidth)
  const heightRef = useRef(overlayH)
  widthRef.current = colWidth
  userWidthRef.current = userColWidth
  heightRef.current = overlayH

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible, streaming, thinkTokens, classifying, readingArticle])

  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (d.axis === 'agent-x') {
        setColWidth(clampCol(d.start + (e.clientX - d.pos)))
        return
      }
      if (d.axis === 'user-x') {
        setUserColWidth(clampCol(d.start + (d.pos - e.clientX)))
        return
      }
      setOverlayH(clampChatOverlayH(d.start + (d.pos - e.clientY)))
    }
    const onUp = () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      setResizing(null)
      document.body.classList.remove(
        'agent-col-dragging',
        'user-col-dragging',
        'chat-h-dragging',
      )
      if (d.axis === 'agent-x') saveJson(AGENT_COL_KEY, widthRef.current)
      else if (d.axis === 'user-x') saveJson(USER_COL_KEY, userWidthRef.current)
      else saveJson(CHAT_H_KEY, heightRef.current)
    }
    const onResize = () => {
      setColWidth((w) => clampCol(w))
      setUserColWidth((w) => clampCol(w))
      setOverlayH((h) => clampChatOverlayH(h))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const beginColResize = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { axis: 'agent-x', pos: e.clientX, start: widthRef.current }
    setResizing('agent-x')
    document.body.classList.add('agent-col-dragging')
  }

  const beginUserColResize = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { axis: 'user-x', pos: e.clientX, start: userWidthRef.current }
    setResizing('user-x')
    document.body.classList.add('user-col-dragging')
  }

  const beginHeightResize = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { axis: 'y', pos: e.clientY, start: heightRef.current }
    setResizing('y')
    document.body.classList.add('chat-h-dragging')
  }

  return (
    <div
      className={`chat-overlay-shell${resizing === 'agent-x' ? ' resizing' : ''}${
        resizing === 'user-x' ? ' resizing-user' : ''
      }${resizing === 'y' ? ' resizing-h' : ''}`}
      style={
        {
          '--agent-col-width': `${colWidth}px`,
          '--user-col-width': `${userColWidth}px`,
          '--chat-overlay-height': `${overlayH}px`,
        } as CSSProperties
      }
    >
      <ChatOverlayResize onPointerDown={beginHeightResize} />
      <div className="chat-overlay" ref={scroller}>
      {visible.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="bubble-row user">
              <div className="bubble user">{m.content}</div>
              <UserColResize onPointerDown={beginUserColResize} />
            </div>
          )
        }
        const isLive = m.id === liveId
        const thinking = isLive && thinkTokens > 0 && !m.content
        const raw = m.content || (isLive && !thinking ? '…' : '')
        const { text, urls } = raw ? parseNewsLinkLines(raw) : { text: '', urls: [] }
        const body = text || (raw && !urls.length ? raw : '')
        const speaker =
          (m.personaId && getPersonaById(m.personaId)) ||
          personas.find((p) => p.id === m.personaId) ||
          persona
        const emoticon = m.face || speaker.defaultFace
        const title = m.model
          ? `${emoticon} ${speaker.name} - ${m.model}`
          : `${emoticon} ${speaker.name}`
        return (
          <div
            key={m.id}
            className={`bubble-row agent${
              speakingMessageId === m.id ? ' speaking' : ''
            }`}
          >
            <div className="agent-head">
              <div className="agent-name" title={title}>
                {title}
              </div>
              <SpeakButton
                messageId={m.id}
                content={m.content}
                speaking={speakingMessageId === m.id}
              />
            </div>
            {thinking ? (
              <div className="think-status" aria-live="polite">
                Thinking... {thinkTokens.toLocaleString()} tokens
              </div>
            ) : null}
            {body ? <div className="bubble agent">{body}</div> : null}
            {urls.length || m.addressedPersonaIds?.length ? (
              <div className="bubble-links">
                {urls.map((href) => (
                  <NewsSourceLink key={href} url={href} />
                ))}
                {m.addressedPersonaIds?.length ? (
                  <PersonaAddressRow
                    messageId={m.id}
                    personaIds={m.addressedPersonaIds}
                    status={m.addressStatus}
                  />
                ) : null}
              </div>
            ) : null}
            <AgentColResize onPointerDown={beginColResize} />
          </div>
        )
      })}
      {readingArticle ? (
        <div className="bubble-row agent">
          <div className="think-status" aria-live="polite">
            Reading the article...
          </div>
          <AgentColResize onPointerDown={beginColResize} />
        </div>
      ) : null}
      {classifying ? (
        <div className="bubble-row agent">
          <div className="think-status" aria-live="polite">
            Finding who should answer...
          </div>
          <AgentColResize onPointerDown={beginColResize} />
        </div>
      ) : null}
    </div>
    </div>
  )
}
