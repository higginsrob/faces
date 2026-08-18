import { useState } from 'react'
import { useOllamaConfig } from '../../ollama/store'
import { useUserProfile } from '../../profile/store'
import {
  prepareKeywordAdd,
  resolveKeywordKeep,
  type TopicLists,
  type TopicOverlap,
} from '../../web/topicConflict'
import {
  MAX_CARE_TOPICS,
  MAX_SKIP_TOPICS,
  parseTopicList,
} from '../../web/topics'
import { TopicConflictDialog } from '../TopicConflictDialog'
import { TopicGuideModal } from '../TopicGuideModal'
import { TopicTags } from '../TopicTags'
import type { WebConfig, WebSources } from '../../web/types'

export type NewsDigestDraft = {
  sources: WebSources
  topics: string[]
  ignoreTopics: string[]
}

export function digestDraftFromConfig(cfg: WebConfig): NewsDigestDraft {
  return {
    sources: { ...cfg.sources },
    topics: [...cfg.topics],
    ignoreTopics: [...cfg.ignoreTopics],
  }
}

export function digestDraftsEqual(a: NewsDigestDraft, b: NewsDigestDraft): boolean {
  return (
    a.sources.clock === b.sources.clock &&
    a.sources.weather === b.sources.weather &&
    a.sources.nationalNews === b.sources.nationalNews &&
    a.sources.localNews === b.sources.localNews &&
    sameTopics(a.topics, b.topics) &&
    sameTopics(a.ignoreTopics, b.ignoreTopics)
  )
}

function sameTopics(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((topic, i) => topic === b[i])
}

export function NewsDigestFields({
  value,
  onChange,
}: {
  value: NewsDigestDraft
  onChange: (next: NewsDigestDraft) => void
}) {
  const profile = useUserProfile()
  const ollama = useOllamaConfig()
  const [guideOpen, setGuideOpen] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    keyword: string
    overlaps: TopicOverlap[]
    lists: TopicLists
  } | null>(null)
  const fallbackTopics =
    value.topics.length === 0 ? parseTopicList(profile.interests) : []

  const patchSources = (patch: Partial<WebSources>) => {
    onChange({ ...value, sources: { ...value.sources, ...patch } })
  }

  const addFromSide = (side: 'care' | 'skip', raw: string) => {
    const added =
      side === 'care'
        ? parseTopicList(raw, MAX_CARE_TOPICS)
        : parseTopicList(raw, MAX_SKIP_TOPICS)
    if (!added.length) return

    let current: TopicLists = {
      topics: value.topics,
      ignoreTopics: value.ignoreTopics,
    }
    let nextConflict: {
      keyword: string
      overlaps: TopicOverlap[]
      lists: TopicLists
    } | null = null
    let fullLimit: number | null = null

    for (const keyword of added) {
      const prepared = prepareKeywordAdd(current, keyword, side)
      if (prepared.status === 'ready') {
        current = prepared.next
        continue
      }
      if (prepared.status === 'full') {
        fullLimit = prepared.limit
        break
      }
      if (prepared.status === 'conflict') {
        nextConflict = {
          keyword: prepared.keyword,
          overlaps: prepared.overlaps,
          lists: current,
        }
        break
      }
    }

    if (
      !sameTopics(current.topics, value.topics) ||
      !sameTopics(current.ignoreTopics, value.ignoreTopics)
    ) {
      onChange({ ...value, ...current })
    }
    setTagError(fullLimit != null ? `Remove a topic first (max ${fullLimit}).` : null)
    setConflict(nextConflict)
  }

  const addTopic = (raw: string) => addFromSide('care', raw)
  const addIgnoreTopic = (raw: string) => addFromSide('skip', raw)

  const onKeep = (keep: 'care' | 'skip') => {
    if (!conflict) return
    const resolved = resolveKeywordKeep(conflict.lists, conflict.keyword, keep)
    if (resolved.status === 'full') {
      setTagError(`Remove a topic first (max ${resolved.limit}).`)
      setConflict(null)
      return
    }
    if (resolved.status !== 'ready') {
      setConflict(null)
      return
    }
    setTagError(null)
    setConflict(null)
    onChange({ ...value, ...resolved.next })
  }

  return (
    <>
      <section>
        <h3>Data sources</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={value.sources.clock}
            onChange={(e) => patchSources({ clock: e.target.checked })}
          />
          Local date and time
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.sources.weather}
            onChange={(e) => patchSources({ weather: e.target.checked })}
          />
          Weather
        </label>
        {value.sources.weather && !profile.location.trim() ? (
          <p className="hint">Add a location in this profile to fetch weather.</p>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={value.sources.nationalNews}
            onChange={(e) => patchSources({ nationalNews: e.target.checked })}
          />
          National news
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.sources.localNews}
            onChange={(e) => patchSources({ localNews: e.target.checked })}
          />
          Local news
        </label>
        {value.sources.localNews && !profile.location.trim() ? (
          <p className="hint">Add a location in this profile to fetch local news.</p>
        ) : null}
      </section>

      <section>
        <div className="section-head">
          <h3>Topics you care about</h3>
          <button
            type="button"
            disabled={!ollama.model}
            aria-haspopup="dialog"
            onClick={() => setGuideOpen(true)}
          >
            Guide
          </button>
        </div>
        <p className="hint">
          Only these extra subjects are fetched beyond the sources above. If you
          leave this empty, this profile&apos;s interests are used instead. Short
          words can collide in news search — add a hint in parentheses if needed,
          like drums (music).
        </p>
        <TopicTags
          topics={value.topics}
          fallback={fallbackTopics}
          placeholder="Add a topic"
          onAdd={addTopic}
          onRemove={(topic) =>
            onChange({
              ...value,
              topics: value.topics.filter((t) => t !== topic),
            })
          }
        />
        {fallbackTopics.length && !value.topics.length ? (
          <p className="hint">Using this profile&apos;s interests until you add topics here.</p>
        ) : null}
        {!ollama.model ? (
          <p className="hint">Pick a chat model to use Guide.</p>
        ) : null}
      </section>

      <section>
        <div className="section-head">
          <h3>Topics you don&apos;t care about</h3>
          <button
            type="button"
            disabled={!ollama.model}
            aria-haspopup="dialog"
            onClick={() => setGuideOpen(true)}
          >
            Guide
          </button>
        </div>
        <p className="hint">
          Faces skip these subjects in the briefing and will not bring them up
          unless you ask. Short words can collide — add a hint in parentheses
          if needed, like drums (oil).
        </p>
        <TopicTags
          topics={value.ignoreTopics}
          placeholder="Add a topic to skip"
          skip
          onAdd={addIgnoreTopic}
          onRemove={(topic) =>
            onChange({
              ...value,
              ignoreTopics: value.ignoreTopics.filter((t) => t !== topic),
            })
          }
        />
        {tagError ? (
          <p className="hint newspaper-keyword-error" role="status">
            {tagError}
          </p>
        ) : null}
      </section>

      {guideOpen ? (
        <TopicGuideModal
          topics={value.topics.length ? value.topics : fallbackTopics}
          ignoreTopics={value.ignoreTopics}
          onApply={(next) => onChange({ ...value, ...next })}
          onClose={() => setGuideOpen(false)}
        />
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
}
