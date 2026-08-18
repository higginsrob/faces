import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { TopicOverlap } from '../web/topicConflict'

export function TopicConflictDialog({
  keyword,
  overlaps,
  onKeepCare,
  onKeepSkip,
  onCancel,
}: {
  keyword: string
  overlaps: TopicOverlap[]
  onKeepCare: () => void
  onKeepSkip: () => void
  onCancel: () => void
}) {
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKey, true)
    keepRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const similar = overlaps
    .map((o) => (o.care.toLowerCase() === keyword.toLowerCase() ? o.skip : o.care))
    .filter((item, i, all) => all.findIndex((t) => t.toLowerCase() === item.toLowerCase()) === i)

  const sheet = (
    <div
      className="lightbox-overlay newspaper-confirm topic-conflict-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="lightbox-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topic-conflict-title"
      >
        <header className="lightbox-head">
          <h2 id="topic-conflict-title">This topic is on both lists</h2>
        </header>
        <p className="hint">
          “{keyword}” cannot live in both interests and topics you&apos;re not
          interested in
          {similar.length
            ? ` (similar: ${similar.map((item) => `“${item}”`).join(', ')})`
            : ''}
          . Delete one. Which should exist?
        </p>
        <div className="lightbox-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onKeepSkip}>
            Keep not interested
          </button>
          <button
            ref={keepRef}
            type="button"
            className="lightbox-close"
            onClick={onKeepCare}
          >
            Keep interested
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}
