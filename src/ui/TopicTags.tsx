import { useState } from 'react'

export function TopicTags({
  topics,
  fallback = [],
  placeholder,
  skip,
  onAdd,
  onRemove,
}: {
  topics: string[]
  fallback?: string[]
  placeholder: string
  skip?: boolean
  onAdd: (raw: string) => void
  onRemove: (topic: string) => void
}) {
  const [draft, setDraft] = useState('')

  const commit = (raw: string) => {
    onAdd(raw)
    setDraft('')
  }

  return (
    <div className="web-tags">
      {topics.map((topic) => (
        <span key={topic} className={skip ? 'web-tag skip' : 'web-tag'}>
          {topic}
          <button
            type="button"
            aria-label={`Remove ${topic}`}
            onClick={() => onRemove(topic)}
          >
            ×
          </button>
        </span>
      ))}
      {fallback.map((topic) => (
        <span key={`profile-${topic}`} className="web-tag muted">
          {topic}
        </span>
      ))}
      <input
        className="web-tag-input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
      />
    </div>
  )
}
