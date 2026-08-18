import { useState } from 'react'
import { useUserProfile } from '../../profile/store'
import { patchWebConfig, patchWebSources, useWebConfig } from '../../web/store'
import { parseTopicList } from '../../web/topics'

function TopicTags({
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

function mergeTopics(existing: string[], added: string[]): string[] {
  const seen = new Set(existing.map((t) => t.toLowerCase()))
  const merged = [...existing]
  for (const topic of added) {
    const key = topic.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(topic)
  }
  return merged
}

export function WebPanel() {
  const cfg = useWebConfig()
  const profile = useUserProfile()

  const addTopic = (raw: string) => {
    const next = parseTopicList(raw)
    if (!next.length) return
    const keys = new Set(next.map((t) => t.toLowerCase()))
    patchWebConfig({
      topics: mergeTopics(cfg.topics, next),
      ignoreTopics: cfg.ignoreTopics.filter((t) => !keys.has(t.toLowerCase())),
    })
  }

  const addIgnoreTopic = (raw: string) => {
    const next = parseTopicList(raw)
    if (!next.length) return
    const keys = new Set(next.map((t) => t.toLowerCase()))
    patchWebConfig({
      ignoreTopics: mergeTopics(cfg.ignoreTopics, next),
      topics: cfg.topics.filter((t) => !keys.has(t.toLowerCase())),
    })
  }

  const fallbackTopics =
    cfg.topics.length === 0 ? parseTopicList(profile.interests) : []

  return (
    <div className="settings-stack">
      <p className="hint">
        Faces fetches a daily briefing in the browser, ranks it for you from
        your profile and thumbs, and gives the top stories to every persona as
        background. They never get a search tool. Headlines are from the past
        two weeks and cached once a day; once a face brings one up, it stays
        off the list unless you steer back to it. Turn on News to show the
        newspaper button next to Settings — open it to vote, mark mentions, and
        load source pages into this chat. GitHub Pages cannot proxy news sites,
        so Faces uses Jina Search for headlines and Jina Reader for source
        pages. Paywalled pages may not come through.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => patchWebConfig({ enabled: e.target.checked })}
        />
        Enable News
      </label>

      <section>
        <h3>Jina</h3>
        <p className="hint">
          Headlines come from{' '}
          <a href="https://jina.ai/" target="_blank" rel="noreferrer">
            Jina Search
          </a>
          . Source pages are fetched through{' '}
          <a href="https://jina.ai/reader/" target="_blank" rel="noreferrer">
            Jina Reader
          </a>
          . Paste a free API key from{' '}
          <a
            href="https://jina.ai/api-dashboard/key-manager"
            target="_blank"
            rel="noreferrer"
          >
            jina.ai
          </a>
          . It is stored only in this browser.
        </p>
        <div className="form-grid">
          <label className="span-2">
            API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={cfg.jinaApiKey}
              placeholder="Paste your Jina API key"
              onChange={(e) => patchWebConfig({ jinaApiKey: e.target.value })}
            />
          </label>
        </div>
        {cfg.enabled && !cfg.jinaApiKey.trim() ? (
          <p className="hint">
            Add a Jina API key to fetch local and topic headlines and to load
            full articles. National news can still use Wikipedia without a
            key.
          </p>
        ) : null}
      </section>

      <section>
        <h3>Data sources</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.sources.clock}
            onChange={(e) => patchWebSources({ clock: e.target.checked })}
          />
          Local date and time
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.sources.weather}
            onChange={(e) => patchWebSources({ weather: e.target.checked })}
          />
          Weather
        </label>
        {cfg.sources.weather && !profile.location.trim() ? (
          <p className="hint">Add a location in Profile to fetch weather.</p>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.sources.nationalNews}
            onChange={(e) => patchWebSources({ nationalNews: e.target.checked })}
          />
          National news
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.sources.localNews}
            onChange={(e) => patchWebSources({ localNews: e.target.checked })}
          />
          Local news
        </label>
        {cfg.sources.localNews && !profile.location.trim() ? (
          <p className="hint">Add a location in Profile to fetch local news.</p>
        ) : null}
      </section>

      <section>
        <h3>Topics you care about</h3>
        <p className="hint">
          Only these extra subjects are fetched beyond the sources above. If you
          leave this empty, Profile interests are used instead. Short words can
          collide in news search — add a hint in parentheses if needed, like
          drums (music).
        </p>
        <TopicTags
          topics={cfg.topics}
          fallback={fallbackTopics}
          placeholder="Add a topic"
          onAdd={addTopic}
          onRemove={(topic) =>
            patchWebConfig({
              topics: cfg.topics.filter((t) => t !== topic),
            })
          }
        />
        {fallbackTopics.length && !cfg.topics.length ? (
          <p className="hint">Using Profile interests until you add topics here.</p>
        ) : null}
      </section>

      <section>
        <h3>Topics you don&apos;t care about</h3>
        <p className="hint">
          Faces skip these subjects in the briefing and will not bring them up
          unless you ask. Short words can collide — add a hint in parentheses
          if needed, like drums (oil).
        </p>
        <TopicTags
          topics={cfg.ignoreTopics}
          placeholder="Add a topic to skip"
          skip
          onAdd={addIgnoreTopic}
          onRemove={(topic) =>
            patchWebConfig({
              ignoreTopics: cfg.ignoreTopics.filter((t) => t !== topic),
            })
          }
        />
      </section>
    </div>
  )
}
