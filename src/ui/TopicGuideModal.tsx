import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { friendlyOllamaError, type ChatTurn } from '../ollama/client'
import { useOllamaConfig } from '../ollama/store'
import { newId } from '../storage'
import { runGuideTurn } from '../web/guide'
import {
  applyTopicChange,
  findTopicOverlaps,
  planTopicAdds,
  type PendingTopicChange,
} from '../web/topicConflict'
import {
  MAX_CARE_TOPICS,
  MAX_SKIP_TOPICS,
  parseTopicList,
} from '../web/topics'
import { TopicTags } from './TopicTags'

type LogItem = {
  id: string
  role: 'user' | 'assistant' | 'status'
  content: string
}

const LIMITS = { care: MAX_CARE_TOPICS, skip: MAX_SKIP_TOPICS }

function overlapHint(overlaps: ReturnType<typeof findTopicOverlaps>): string {
  if (!overlaps.length) return ''
  return overlaps
    .map((o) => `“${o.care}” (care about) overlaps “${o.skip}” (don’t care) — ${o.reason}`)
    .join('\n')
}

function changeNote(change: {
  addCare?: string[]
  addSkip?: string[]
  dropCare?: string[]
  dropSkip?: string[]
}): string {
  const parts: string[] = []
  if (change.addCare?.length) {
    parts.push(`added to topics you care about: ${change.addCare.join(', ')}`)
  }
  if (change.addSkip?.length) {
    parts.push(`added to topics you don’t care about: ${change.addSkip.join(', ')}`)
  }
  if (change.dropCare?.length) {
    parts.push(`removed from topics you care about: ${change.dropCare.join(', ')}`)
  }
  if (change.dropSkip?.length) {
    parts.push(`removed from topics you don’t care about: ${change.dropSkip.join(', ')}`)
  }
  return parts.join('; ')
}

export function TopicGuideModal({
  topics,
  ignoreTopics,
  onApply,
  onClose,
}: {
  topics: string[]
  ignoreTopics: string[]
  onApply: (next: { topics: string[]; ignoreTopics: string[] }) => void
  onClose: () => void
}) {
  const ollama = useOllamaConfig()
  const [lists, setLists] = useState({ topics, ignoreTopics })
  const [log, setLog] = useState<LogItem[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState<PendingTopicChange[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<ChatTurn[]>([])
  const listsRef = useRef(lists)
  const queueRef = useRef<PendingTopicChange[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const noteRef = useRef('')

  listsRef.current = lists
  const active = pending[0] ?? null
  const overlaps = findTopicOverlaps(lists.topics, lists.ignoreTopics)
  const canFinish = !busy && !active && overlaps.length === 0

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [log, busy, pending, error])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (queueRef.current.length) declinePending()
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const setQueue = (next: PendingTopicChange[]) => {
    queueRef.current = next
    setPending(next)
  }

  const ingestAdds = (addCare: string[], addSkip: string[]) => {
    const planned = planTopicAdds(listsRef.current, addCare, addSkip)
    if (planned.immediateCare.length || planned.immediateSkip.length) {
      const applied = {
        addCare: planned.immediateCare,
        addSkip: planned.immediateSkip,
      }
      listsRef.current = applyTopicChange(listsRef.current, applied, LIMITS)
      setLists(listsRef.current)
      setLog((prev) => [
        ...prev,
        { id: newId(), role: 'status', content: changeNote(applied) },
      ])
    }
    if (planned.pending.length) setQueue([...queueRef.current, ...planned.pending])
  }

  const ask = async (userText: string, echoUser = false) => {
    if (!ollama.model) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setError(null)
    setReady(false)
    if (echoUser) {
      setLog((prev) => [
        ...prev,
        { id: newId(), role: 'user', content: userText },
      ])
    }
    const note = noteRef.current
    noteRef.current = ''
    const prompt = note ? `${note}\n\n${userText}` : userText
    try {
      const { turn } = await runGuideTurn({
        history: historyRef.current,
        lists: listsRef.current,
        userText: prompt,
        signal: ac.signal,
      })
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: prompt },
        { role: 'assistant', content: turn.say },
      ]
      setLog((prev) => [
        ...prev,
        { id: newId(), role: 'assistant', content: turn.say },
      ])
      ingestAdds(turn.addTopics, turn.addIgnore)
      const leftover = findTopicOverlaps(
        listsRef.current.topics,
        listsRef.current.ignoreTopics,
      )
      setReady(turn.ready && leftover.length === 0 && queueRef.current.length === 0)
    } catch (e) {
      if (ac.signal.aborted) return
      setError(friendlyOllamaError(e))
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  useEffect(() => {
    if (!ollama.model) {
      setError('Pick a chat model in Settings before using Guide.')
      return
    }
    void ask('Start the interview. Ask the first question. Do not add topics yet.')
    return () => {
      abortRef.current?.abort()
    }
  }, [ollama.model])

  useEffect(() => {
    if (busy || active) return
    inputRef.current?.focus()
  }, [busy, active])

  const send = () => {
    const text = draft.trim()
    if (!text || busy || active) return
    setDraft('')
    void ask(text, true)
  }

  const applyChange = (change: PendingTopicChange, patch: Partial<PendingTopicChange>) => {
    listsRef.current = applyTopicChange(listsRef.current, { ...change, ...patch }, LIMITS)
    setLists(listsRef.current)
  }

  const confirmPending = () => {
    const change = queueRef.current[0]
    if (!change || change.mutual) return
    applyChange(change, {})
    noteRef.current = `The user confirmed that change (${changeNote(change)}).`
    setLog((prev) => [
      ...prev,
      { id: newId(), role: 'status', content: changeNote(change) },
    ])
    setQueue(queueRef.current.slice(1))
  }

  const keepCare = () => {
    const change = queueRef.current[0]
    if (!change?.mutual) return
    const applied = { ...change, addSkip: [], dropCare: [], dropSkip: [] }
    applyChange(change, { addSkip: [], dropCare: [], dropSkip: [] })
    noteRef.current = `The user kept CARE ABOUT and skipped the overlapping skip topics (${changeNote(applied)}).`
    setLog((prev) => [
      ...prev,
      { id: newId(), role: 'status', content: changeNote(applied) },
    ])
    setQueue(queueRef.current.slice(1))
  }

  const keepSkip = () => {
    const change = queueRef.current[0]
    if (!change?.mutual) return
    const applied = { ...change, addCare: [], dropCare: [], dropSkip: [] }
    applyChange(change, { addCare: [], dropCare: [], dropSkip: [] })
    noteRef.current = `The user kept DO NOT CARE ABOUT and skipped the overlapping care topics (${changeNote(applied)}).`
    setLog((prev) => [
      ...prev,
      { id: newId(), role: 'status', content: changeNote(applied) },
    ])
    setQueue(queueRef.current.slice(1))
  }

  const declinePending = () => {
    const change = queueRef.current[0]
    if (!change) return
    noteRef.current =
      'The user declined the last proposed add. Do not add those topics unless they ask again.'
    setLog((prev) => [
      ...prev,
      { id: newId(), role: 'status', content: 'Didn’t add those topics.' },
    ])
    setQueue(queueRef.current.slice(1))
  }

  const addFromTags = (side: 'care' | 'skip', raw: string) => {
    const next =
      side === 'care'
        ? parseTopicList(raw, MAX_CARE_TOPICS)
        : parseTopicList(raw, MAX_SKIP_TOPICS)
    if (!next.length || busy) return
    ingestAdds(side === 'care' ? next : [], side === 'skip' ? next : [])
  }

  const finish = () => {
    if (!canFinish) return
    onApply({
      topics: lists.topics,
      ignoreTopics: lists.ignoreTopics,
    })
    onClose()
  }

  const sheet = (
    <div
      className="lightbox-overlay guide-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="lightbox-sheet guide-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topic-guide-title"
      >
        <header className="lightbox-head">
          <h2 id="topic-guide-title">Guide</h2>
        </header>
        <p className="hint">
          A short interview to fill topics you care about and topics to skip.
          Overlapping items have to be resolved before you can save.
        </p>

        <section className="guide-lists">
          <div>
            <h3>Topics you care about</h3>
            <TopicTags
              topics={lists.topics}
              placeholder="Add a topic"
              onAdd={(raw) => addFromTags('care', raw)}
              onRemove={(topic) => {
                listsRef.current = {
                  ...listsRef.current,
                  topics: listsRef.current.topics.filter((t) => t !== topic),
                }
                setLists(listsRef.current)
              }}
            />
          </div>
          <div>
            <h3>Topics you don&apos;t care about</h3>
            <TopicTags
              topics={lists.ignoreTopics}
              placeholder="Add a topic to skip"
              skip
              onAdd={(raw) => addFromTags('skip', raw)}
              onRemove={(topic) => {
                listsRef.current = {
                  ...listsRef.current,
                  ignoreTopics: listsRef.current.ignoreTopics.filter(
                    (t) => t !== topic,
                  ),
                }
                setLists(listsRef.current)
              }}
            />
          </div>
        </section>

        {overlaps.length ? (
          <p className="guide-conflict" role="status">
            {overlapHint(overlaps)}
          </p>
        ) : null}

        <div className="guide-log" ref={logRef}>
          {log.map((item) => (
            <div key={item.id} className={`guide-msg ${item.role}`}>
              {item.content}
            </div>
          ))}
          {busy ? (
            <div className="guide-msg status" aria-live="polite">
              Thinking…
            </div>
          ) : null}
        </div>

        {error ? <p className="status bad">{error}</p> : null}

        {active ? (
          <PendingCard
            change={active}
            onConfirm={confirmPending}
            onKeepCare={keepCare}
            onKeepSkip={keepSkip}
            onDecline={declinePending}
          />
        ) : (
          <div className="guide-compose">
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder={
                ollama.model
                  ? 'Answer in your own words'
                  : 'Pick a chat model in Settings'
              }
              disabled={busy || !ollama.model}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button
              type="button"
              disabled={busy || !draft.trim() || !ollama.model}
              onClick={send}
            >
              Send
            </button>
          </div>
        )}

        <div className="lightbox-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lightbox-close"
            disabled={!canFinish}
            title={
              busy
                ? 'Wait for the guide'
                : active
                  ? 'Confirm or dismiss the pending change first'
                  : overlaps.length
                    ? 'Resolve overlapping topics first'
                    : ready
                      ? 'Looks good'
                      : undefined
            }
            onClick={finish}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}

function PendingCard({
  change,
  onConfirm,
  onKeepCare,
  onKeepSkip,
  onDecline,
}: {
  change: PendingTopicChange
  onConfirm: () => void
  onKeepCare: () => void
  onKeepSkip: () => void
  onDecline: () => void
}) {
  if (change.mutual) {
    return (
      <div className="guide-confirm" role="alertdialog" aria-labelledby="guide-pending-title">
        <h3 id="guide-pending-title">These new topics overlap</h3>
        <p className="hint">
          They can&apos;t both be saved. Keep one list, or don&apos;t add them.
        </p>
        <PendingTags label="Would add to topics you care about" items={change.addCare} />
        <PendingTags
          label="Would add to topics you don’t care about"
          items={change.addSkip}
          skip
        />
        <div className="lightbox-actions">
          <button type="button" onClick={onDecline}>
            Don&apos;t add
          </button>
          <button type="button" onClick={onKeepSkip}>
            Keep skip
          </button>
          <button type="button" className="lightbox-close" onClick={onKeepCare}>
            Keep care
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="guide-confirm" role="alertdialog" aria-labelledby="guide-pending-title">
      <h3 id="guide-pending-title">This will remove overlapping topics</h3>
      <p className="hint">
        Confirm to add the new items and drop the ones that are too similar on
        the other list.
      </p>
      <PendingTags label="Add to topics you care about" items={change.addCare} />
      <PendingTags
        label="Add to topics you don’t care about"
        items={change.addSkip}
        skip
      />
      <PendingTags
        label="Remove from topics you care about"
        items={change.dropCare}
      />
      <PendingTags
        label="Remove from topics you don’t care about"
        items={change.dropSkip}
        skip
      />
      <div className="lightbox-actions">
        <button type="button" onClick={onDecline}>
          Don&apos;t add
        </button>
        <button type="button" className="lightbox-close" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    </div>
  )
}

function PendingTags({
  label,
  items,
  skip,
}: {
  label: string
  items: string[]
  skip?: boolean
}) {
  if (!items.length) return null
  return (
    <div className="guide-pending-block">
      <p>{label}</p>
      <div className="web-tags">
        {items.map((topic) => (
          <span key={topic} className={skip ? 'web-tag skip' : 'web-tag'}>
            {topic}
          </span>
        ))}
      </div>
    </div>
  )
}
