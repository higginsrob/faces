import { useEffect, useState, type ReactNode } from 'react'
import { setNewsOpen, useSession } from '../chat/session'
import { isConversationalItem } from '../web/age'
import { dropArticle, useArticleShelf } from '../web/articles'
import { toggleMentionedId, useWebDigest } from '../web/digest'
import { ensureWebDigest } from '../web/ensure'
import { formatLocalClock } from '../web/fetchers/clock'
import { clip } from '../web/fetchers/http'
import { useNewsPrefs, voteForItem } from '../web/prefs'
import { forYouStories, voteOnStory } from '../web/rerank'
import { useWebConfig } from '../web/store'
import type { WebItem } from '../web/types'
import { defaultHudBounds, HudWindow } from './HudWindow'
import { NewsSourceLink } from './NewsSourceLink'

function publishedLabel(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function Story({
  item,
  mentioned,
}: {
  item: WebItem
  mentioned: Set<string>
}) {
  const prefs = useNewsPrefs()
  const used = mentioned.has(item.id)
  const vote = voteForItem(item, prefs)
  const conversational = isConversationalItem(item)
  const date = publishedLabel(item.publishedAt)
  const down = vote === -1
  return (
    <article
      className={`newspaper-story${used ? ' mentioned' : ''}${down ? ' downvoted' : ''}`}
    >
      <header>
        {date ? <time>{date}</time> : <span />}
        {conversational ? (
          <div className="newspaper-story-actions">
            <div className="newspaper-votes">
              <button
                type="button"
                className={vote === 1 ? 'on' : ''}
                aria-label="More like this"
                aria-pressed={vote === 1}
                onClick={() => voteOnStory(item, 1)}
              >
                ▲
              </button>
              <button
                type="button"
                className={vote === -1 ? 'on' : ''}
                aria-label="Less like this"
                aria-pressed={vote === -1}
                onClick={() => voteOnStory(item, -1)}
              >
                ▼
              </button>
            </div>
            <label className="newspaper-mention">
              Mentioned
              <input
                type="checkbox"
                checked={used}
                title="When checked, this story stays off the list unless you steer back to it."
                onChange={() => toggleMentionedId(item.id)}
              />
            </label>
          </div>
        ) : null}
      </header>
      <h4>{item.title}</h4>
      {item.blurb ? <p>{item.blurb}</p> : null}
      {item.url ? <NewsSourceLink url={item.url} title={item.title} /> : null}
    </article>
  )
}

function Section({
  kicker,
  children,
}: {
  kicker: string
  children: ReactNode
}) {
  return (
    <section className="newspaper-section">
      <h3>{kicker}</h3>
      {children}
    </section>
  )
}

export function Newspaper() {
  const { newsOpen } = useSession()
  const cfg = useWebConfig()
  const digest = useWebDigest()
  const articles = useArticleShelf()
  const [clock, setClock] = useState(() => formatLocalClock())
  const open = newsOpen && cfg.enabled

  useEffect(() => {
    if (!cfg.enabled) setNewsOpen(false)
  }, [cfg.enabled])

  useEffect(() => {
    if (!open || !cfg.sources.clock) return
    const tick = () => setClock(formatLocalClock())
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [open, cfg.sources.clock])

  const mentioned = new Set(digest.mentionedIds)
  const weather = digest.items.filter((item) => item.source === 'weather')
  const stories = forYouStories(digest.items, mentioned)
  const fetchedLabel = digest.fetchedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(digest.fetchedAt))
    : null
  const hasStories = weather.length > 0 || stories.length > 0

  return (
    <HudWindow
      open={open}
      label="The Daily Face"
      className="newspaper-paper"
      overlayClassName="newspaper-overlay"
      defaultBounds={() =>
        defaultHudBounds({ side: 'left', width: 580, heightRatio: 0.7 })
      }
      header={<span className="hud-win-title">The Daily Face</span>}
      trailing={
        <button
          type="button"
          className="hud-win-action"
          disabled={digest.status === 'fetching'}
          onClick={() => void ensureWebDigest({ force: true })}
        >
          {digest.status === 'fetching' ? 'Fetching…' : 'Refresh'}
        </button>
      }
      onClose={() => setNewsOpen(false)}
    >
      {open ? (
        <>
          <header className="newspaper-masthead">
        {fetchedLabel ? (
          <p className="newspaper-fetched">Fetched {fetchedLabel}</p>
        ) : null}
        <p className="newspaper-flag">Vol. I · Faces edition</p>
        <h2 id="newspaper-masthead">The Daily Face</h2>
        <p className="newspaper-dateline">
          {cfg.sources.clock
            ? `${clock.weekdayDate}  ·  ${clock.time}`
            : fetchedLabel
              ? fetchedLabel
              : 'Today’s briefing'}
        </p>
      </header>

      {digest.error ? (
        <p className="newspaper-error">{digest.error}</p>
      ) : null}

      {articles.items.length ? (
        <div className="newspaper-open">
          <h3>In this chat</h3>
          <p>
            Loaded source text stays in the session until you drop it. At most
            two articles at a time.
          </p>
          {articles.items.map((article) => (
            <article key={article.url} className="newspaper-open-item">
              <header>
                <span>{article.host}</span>
                <button type="button" onClick={() => dropArticle(article.url)}>
                  Drop
                </button>
              </header>
              <strong>{article.title}</strong>
              <p>{clip(article.body, 220)}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="newspaper-spread">
        {!hasStories && digest.status !== 'fetching' ? (
          <p className="newspaper-empty">
            No briefing yet. Refresh to fetch today’s headlines.
          </p>
        ) : null}

        {weather.map((item) => (
          <aside key={item.id} className="newspaper-weather">
            <h3>Weather</h3>
            <strong>{item.title}</strong>
            {item.blurb ? <p>{item.blurb}</p> : null}
          </aside>
        ))}

        {stories.length ? (
          <Section kicker="For you">
            {stories.map((item) => (
              <Story key={item.id} item={item} mentioned={mentioned} />
            ))}
          </Section>
        ) : null}
      </div>
        </>
      ) : null}
    </HudWindow>
  )
}
