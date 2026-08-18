import { useEffect, useRef } from 'react'
import { useSession } from '../chat/session'
import { getActivePersona, getPersonaById, usePersonas } from '../personas/store'
import { parseNewsLinkLines } from '../web/links'
import { NewsSourceLink } from './NewsSourceLink'

export function ChatOverlay() {
  const { messages, streaming, thinkTokens, classifying, readingArticle } =
    useSession()
  const { personas } = usePersonas()
  const persona = getActivePersona()
  const scroller = useRef<HTMLDivElement>(null)
  const visible = messages.filter((m) => m.role !== 'system')
  const liveId = streaming ? visible.at(-1)?.id : undefined

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible, streaming, thinkTokens, classifying, readingArticle])

  return (
    <div className="chat-overlay" ref={scroller}>
      {visible.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="bubble-row user">
              <div className="bubble user">{m.content}</div>
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
        return (
          <div key={m.id} className="bubble-row agent">
            <div className="agent-name">{speaker.name}</div>
            {thinking ? (
              <div className="think-status" aria-live="polite">
                Thinking... {thinkTokens.toLocaleString()} tokens
              </div>
            ) : null}
            {body ? <div className="bubble agent">{body}</div> : null}
            {urls.length ? (
              <div className="bubble-links">
                {urls.map((href) => (
                  <NewsSourceLink key={href} url={href} />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {readingArticle ? (
        <div className="bubble-row agent">
          <div className="think-status" aria-live="polite">
            Reading the article...
          </div>
        </div>
      ) : null}
      {classifying ? (
        <div className="bubble-row agent">
          <div className="think-status" aria-live="polite">
            Finding who should answer...
          </div>
        </div>
      ) : null}
    </div>
  )
}
