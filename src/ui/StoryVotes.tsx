import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUserProfile } from '../profile/store'
import { useNewsPrefs, voteForItem } from '../web/prefs'
import { applyStoryKeywordVote, voteOnStory } from '../web/rerank'
import { useWebConfig } from '../web/store'
import {
  prepareKeywordAdd,
  resolveKeywordKeep,
  type TopicOverlap,
} from '../web/topicConflict'
import { seedCareTopicsIfEmpty, suggestStoryKeyword } from '../web/topics'
import type { WebItem } from '../web/types'
import { TopicConflictDialog } from './TopicConflictDialog'

export function ThumbIcon({ down }: { down?: boolean }) {
  return (
    <svg
      className="newspaper-thumb"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        transform={down ? 'rotate(180 12 12)' : undefined}
        d="M2 21h4V9H2v12Zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 6.59 7.59C6.22 7.95 6 8.45 6 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2Z"
      />
    </svg>
  )
}

export function StoryVotes({
  item,
  compact,
  extra,
  children,
}: {
  item: WebItem
  compact?: boolean
  extra?: ReactNode
  children: (ui: { buttons: ReactNode; panel: ReactNode }) => ReactNode
}) {
  const prefs = useNewsPrefs()
  const cfg = useWebConfig()
  const profile = useUserProfile()
  const vote = voteForItem(item, prefs)
  const [draftSide, setDraftSide] = useState<'care' | 'skip' | null>(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    keyword: string
    overlaps: TopicOverlap[]
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!draftSide) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [draftSide])

  const listsForSide = (side: 'care' | 'skip') =>
    side === 'care'
      ? {
          topics: seedCareTopicsIfEmpty(cfg.topics, profile.interests),
          ignoreTopics: cfg.ignoreTopics,
        }
      : { topics: cfg.topics, ignoreTopics: cfg.ignoreTopics }

  const closeComposer = () => {
    setDraftSide(null)
    setDraft('')
    setDraftError(null)
    setConflict(null)
  }

  const openComposer = (side: 'care' | 'skip') => {
    setConflict(null)
    setDraftError(null)
    setDraftSide(side)
    setDraft(suggestStoryKeyword(item))
  }

  const onThumb = (side: 'care' | 'skip') => {
    const nextVote = side === 'care' ? 1 : -1
    if (vote === nextVote) {
      voteOnStory(item, 0)
      closeComposer()
      return
    }
    if (draftSide === side) {
      closeComposer()
      return
    }
    openComposer(side)
  }

  const commitLists = (
    side: 'care' | 'skip',
    next: { topics: string[]; ignoreTopics: string[] },
  ) => {
    applyStoryKeywordVote(item, side === 'care' ? 1 : -1, next)
    closeComposer()
  }

  const onConfirmKeyword = () => {
    if (!draftSide) return
    const prepared = prepareKeywordAdd(listsForSide(draftSide), draft, draftSide)
    if (prepared.status === 'empty') {
      setDraftError('Add a short topic keyword.')
      return
    }
    if (prepared.status === 'full') {
      setDraftError(
        `Remove a topic in Settings first (max ${prepared.limit}).`,
      )
      return
    }
    if (prepared.status === 'conflict') {
      setDraftError(null)
      setConflict({ keyword: prepared.keyword, overlaps: prepared.overlaps })
      return
    }
    commitLists(draftSide, prepared.next)
  }

  const onKeep = (keep: 'care' | 'skip') => {
    if (!conflict) return
    const resolved = resolveKeywordKeep(
      listsForSide(keep),
      conflict.keyword,
      keep,
    )
    if (resolved.status === 'full') {
      setDraftError(
        `Remove a topic in Settings first (max ${resolved.limit}).`,
      )
      setConflict(null)
      return
    }
    if (resolved.status !== 'ready') {
      setConflict(null)
      return
    }
    commitLists(keep, resolved.next)
  }

  const buttons = (
    <div className={`newspaper-votes${compact ? ' compact' : ''}`}>
      <button
        type="button"
        className={vote === 1 ? 'on' : draftSide === 'care' ? 'pending' : ''}
        aria-label="Add interest"
        aria-pressed={vote === 1}
        aria-expanded={draftSide === 'care'}
        onClick={() => onThumb('care')}
      >
        <ThumbIcon />
      </button>
      <button
        type="button"
        className={vote === -1 ? 'on' : draftSide === 'skip' ? 'pending' : ''}
        aria-label="Add a topic I'm not interested in"
        aria-pressed={vote === -1}
        aria-expanded={draftSide === 'skip'}
        onClick={() => onThumb('skip')}
      >
        <ThumbIcon down />
      </button>
      {extra}
    </div>
  )

  const panel = (
    <>
      {draftSide ? (
        <form
          className="newspaper-keyword"
          onSubmit={(e) => {
            e.preventDefault()
            onConfirmKeyword()
          }}
        >
          <label>
            {draftSide === 'care'
              ? 'Add interest'
              : "Add a topic I'm not interested in"}
            <input
              ref={inputRef}
              value={draft}
              maxLength={48}
              placeholder="Topic keyword"
              onChange={(e) => {
                setDraft(e.target.value)
                setDraftError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeComposer()
                }
              }}
            />
          </label>
          {draftError ? (
            <p className="newspaper-keyword-error" role="status">
              {draftError}
            </p>
          ) : null}
          <div className="newspaper-keyword-actions">
            <button type="button" onClick={closeComposer}>
              Cancel
            </button>
            <button type="submit">Add</button>
          </div>
        </form>
      ) : null}
      {conflict ? (
        <TopicConflictDialog
          keyword={conflict.keyword}
          overlaps={conflict.overlaps}
          onKeepCare={() => onKeep('care')}
          onKeepSkip={() => onKeep('skip')}
          onCancel={() => setConflict(null)}
        />
      ) : null}
    </>
  )

  return children({ buttons, panel })
}
