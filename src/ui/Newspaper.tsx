import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { setError, setNewsOpen, useSession } from '../chat/session'
import { getActivePersona } from '../personas/store'
import { useProfiles, useUserProfile } from '../profile/store'
import { takeCompleteSentences } from '../voice/spokenText'
import { getTtsConfig } from '../voice/ttsStore'
import {
  enqueueSpeak,
  flushSpeak,
  isTtsBusy,
  isTtsPlaying,
  setTtsSpeaker,
  stopTts,
  subscribeTtsActivity,
} from '../voice/tts'
import { isConversationalItem } from '../web/age'
import {
  briefingItemsForText,
  itemsMentionedInSession,
  sameArticleUrl,
  setSpeakingArticleUrl,
  useArticleShelf,
} from '../web/articles'
import { toggleMentionedId, useWebDigest } from '../web/digest'
import { ensureWebDigest } from '../web/ensure'
import { formatLocalClock } from '../web/fetchers/clock'
import { voteForItem } from '../web/prefs'
import { storyPreviewImage, storyPreviewSources } from '../web/preview'
import { forYouStories, isLowConfidenceStory } from '../web/rerank'
import { useWebConfig } from '../web/store'
import {
  closeSourceTab,
  openSourceViewer,
  sourceHostUnframeable,
  useSourceViewer,
} from '../web/viewer'
import {
  youtubeEmbedSrc,
  youtubeTabId,
  YOUTUBE_EMBED_ALLOW,
} from '../web/youtube'
import {
  collectStoryLabels,
  itemMatchesLabels,
  mainInterestLabel,
  resolveFetchTopics,
  sameTopicLabel,
  splitTopicHint,
} from '../web/topics'
import type { WebItem } from '../web/types'
import { defaultHudBounds, HudWindow } from './HudWindow'
import { NewspaperSettings } from './NewspaperSettings'
import { NewsSourceLink } from './NewsSourceLink'
import { StoryVotes } from './StoryVotes'

function publishedLabel(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function formatStoryScore(item: WebItem): string | null {
  if (typeof item.score !== 'number' || !Number.isFinite(item.score)) return null
  return item.score.toFixed(1)
}

function storyScoreTitle(item: WebItem): string {
  const rank = formatStoryScore(item) ?? '—'
  if (typeof item.llmScore === 'number' && Number.isFinite(item.llmScore)) {
    return `Rank ${rank} · model ${item.llmScore.toFixed(2)}`
  }
  return `Rank ${rank} · local only`
}

type StoryLayoutKind = 'photo' | 'brief'

function storyLayoutKind(item: WebItem): StoryLayoutKind {
  if (storyPreviewImage(item)) return 'photo'
  return 'brief'
}

/** Rank-preserving mix so photo cuts and briefs don't clump into one column. */
function packNewspaperStories(items: WebItem[]): WebItem[] {
  if (items.length < 3) return items
  const queue = [...items]
  const mixed: WebItem[] = []
  let last: StoryLayoutKind | '' = ''
  let streak = 0
  while (queue.length) {
    const want =
      last === 'photo' && streak >= 1
        ? 'brief'
        : last === 'brief' && streak >= 2
          ? 'photo'
          : null
    let idx = 0
    if (want) {
      const found = queue.findIndex((item) => storyLayoutKind(item) === want)
      if (found >= 0 && found <= 4) idx = found
    }
    const item = queue.splice(idx, 1)[0]!
    const kind = storyLayoutKind(item)
    if (kind === last) streak += 1
    else {
      last = kind
      streak = 1
    }
    mixed.push(item)
  }
  return mixed
}

function storyMarkLabel(read: boolean, inChat: boolean): string {
  if (read) return 'Read'
  if (inChat) return 'In chat'
  return 'Mentioned'
}

function storyMarkTitle(read: boolean, inChat: boolean): string {
  if (read) return 'This article is loaded into the chat. Uncheck to let faces bring the headline up again.'
  if (inChat) return 'This story came up in this chat. Uncheck to let faces bring it up again.'
  return 'When checked, faces will not bring this story up again unless you ask.'
}

function openStoryPreview(
  e: ReactMouseEvent<HTMLAnchorElement>,
  url: string,
  title: string,
) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
  if (!youtubeEmbedSrc(url) && sourceHostUnframeable(url)) return
  e.preventDefault()
  openSourceViewer({ url, title })
}

const inlineYoutubeListeners = new Set<() => void>()
let inlineYoutubeId: string | null = null

function subscribeInlineYoutube(fn: () => void): () => void {
  inlineYoutubeListeners.add(fn)
  return () => {
    inlineYoutubeListeners.delete(fn)
  }
}

function getInlineYoutubeId(): string | null {
  return inlineYoutubeId
}

function setInlineYoutubeId(id: string | null): void {
  if (inlineYoutubeId === id) return
  inlineYoutubeId = id
  for (const fn of inlineYoutubeListeners) fn()
}

function useInlineYoutube(id: string): {
  playing: boolean
  play: () => void
  stop: () => void
} {
  const playing = useSyncExternalStore(
    subscribeInlineYoutube,
    () => getInlineYoutubeId() === id,
    () => false,
  )
  useEffect(
    () => () => {
      if (getInlineYoutubeId() === id) setInlineYoutubeId(null)
    },
    [id],
  )
  return {
    playing,
    play: () => setInlineYoutubeId(id),
    stop: () => {
      if (getInlineYoutubeId() === id) setInlineYoutubeId(null)
    },
  }
}

function useStoryPreview(item: WebItem) {
  const sources = storyPreviewSources(item)
  const [ok, setOk] = useState(sources.length > 0)
  useEffect(() => {
    setOk(sources.length > 0)
  }, [item.id, item.url, item.imageUrl])
  return {
    featured: ok && sources.length > 0,
    preview:
      ok && sources.length ? (
        <StoryPreview item={item} sources={sources} onFail={() => setOk(false)} />
      ) : null,
  }
}

function StoryPreview({
  item,
  sources,
  onFail,
}: {
  item: WebItem
  sources: string[]
  onFail: () => void
}) {
  const instanceId = useId()
  const { playing, play, stop } = useInlineYoutube(instanceId)
  const viewer = useSourceViewer()
  const [index, setIndex] = useState(0)
  const src = sources[index]
  const url = item.url
  const embed = url ? youtubeEmbedSrc(url) : null
  const autoplaySrc = url ? youtubeEmbedSrc(url, { autoplay: true }) : null
  const tabId = url ? youtubeTabId(url) : null
  const youtube = Boolean(embed)

  useEffect(() => {
    setIndex(0)
    if (getInlineYoutubeId() === instanceId) setInlineYoutubeId(null)
  }, [item.id, instanceId, sources[0]])

  useEffect(() => {
    if (getInlineYoutubeId() !== instanceId || !tabId) return
    if (viewer.tabs.some((tab) => tab.id === tabId)) setInlineYoutubeId(null)
  }, [instanceId, tabId, viewer.tabs])

  if (!src || !url) return null

  const fail = () => {
    if (index + 1 < sources.length) setIndex(index + 1)
    else onFail()
  }

  const onPosterClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!youtube) {
      openStoryPreview(e, url, item.title)
      return
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    if (tabId) closeSourceTab(tabId)
    play()
  }

  const onPopOut = () => {
    openSourceViewer({ url, title: item.title })
  }

  if (playing && autoplaySrc) {
    return (
      <div className="newspaper-story-embed">
        <div className="newspaper-story-embed-bar">
          <span className="newspaper-story-embed-label">YouTube</span>
          <div className="newspaper-story-embed-actions">
            <button type="button" onClick={onPopOut}>
              Pop out
            </button>
            <button type="button" aria-label="Close video" onClick={stop}>
              Close
            </button>
          </div>
        </div>
        <div className="newspaper-story-embed-player">
          <iframe
            title={item.title}
            src={autoplaySrc}
            allow={YOUTUBE_EMBED_ALLOW}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    )
  }

  return (
    <a
      className={`newspaper-story-preview${youtube ? ' youtube' : ''}`}
      href={url}
      target="_blank"
      rel="noreferrer"
      title={item.title}
      aria-label={youtube ? `Watch ${item.title}` : `Open ${item.title}`}
      onClick={onPosterClick}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={fail}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 240) {
            fail()
          }
        }}
      />
      {youtube ? (
        <span className="newspaper-story-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path fill="currentColor" d="M8 6.8v10.4L18 12 8 6.8Z" />
          </svg>
        </span>
      ) : null}
    </a>
  )
}

function StoryCopy({
  title,
  blurb,
  preview,
}: {
  title: string
  blurb: string
  preview?: ReactNode
}) {
  return (
    <div className="newspaper-story-copy">
      {preview}
      <h4>{title}</h4>
      {blurb ? <p>{blurb}</p> : null}
    </div>
  )
}

function Story({
  item,
  mentioned,
  inChat,
  read,
  speaking,
  label,
  labelActive,
  onLabelClick,
}: {
  item: WebItem
  mentioned: Set<string>
  inChat: boolean
  read: boolean
  speaking: boolean
  label: string | null
  labelActive: boolean
  onLabelClick: (label: string) => void
}) {
  const used = mentioned.has(item.id)
  const vote = voteForItem(item)
  const conversational = isConversationalItem(item)
  const date = publishedLabel(item.publishedAt)
  const down = vote === -1
  const score = formatStoryScore(item)
  const mark = storyMarkLabel(read, inChat)
  const labelText = label ? splitTopicHint(label).term : ''
  const { featured, preview } = useStoryPreview(item)

  return (
    <article
      className={`newspaper-story${used ? ' mentioned' : ''}${inChat ? ' in-chat' : ''}${down ? ' downvoted' : ''}${speaking ? ' speaking' : ''}${read ? ' read' : ''}${featured ? ' featured' : ''}`}
    >
      {conversational ? (
        <StoryVotes
          item={item}
          extra={
            score ? (
              <span
                className="newspaper-score"
                title={storyScoreTitle(item)}
                aria-label={storyScoreTitle(item)}
              >
                {score}
              </span>
            ) : null
          }
        >
          {({ buttons, panel }) => (
            <>
              <header>
                {date ? <time>{date}</time> : <span />}
                <label className="newspaper-mention" title={storyMarkTitle(read, inChat)}>
                  {mark}
                  <input
                    type="checkbox"
                    checked={used}
                    title={storyMarkTitle(read, inChat)}
                    onChange={() => toggleMentionedId(item.id)}
                  />
                </label>
              </header>
              <StoryCopy
                title={item.title}
                blurb={item.blurb}
                preview={preview}
              />
              {item.url ? (
                <NewsSourceLink url={item.url} title={item.title} votes={false} />
              ) : null}
              <div className="newspaper-story-actions">
                {label ? (
                  <button
                    type="button"
                    className={`newspaper-story-label${labelActive ? ' on' : ''}`}
                    title={`Filter by ${labelText}`}
                    aria-pressed={labelActive}
                    onClick={() => onLabelClick(label)}
                  >
                    {labelText}
                  </button>
                ) : null}
                {buttons}
              </div>
              {panel}
            </>
          )}
        </StoryVotes>
      ) : (
        <>
          <header>
            {date ? <time>{date}</time> : <span />}
          </header>
          <StoryCopy
            title={item.title}
            blurb={item.blurb}
            preview={preview}
          />
          {item.url ? (
            <NewsSourceLink url={item.url} title={item.title} votes={false} />
          ) : null}
        </>
      )}
    </article>
  )
}

function storyMatchesQuery(item: WebItem, query: string, label: string | null): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = `${item.title} ${item.blurb} ${item.topic ?? ''} ${label ?? ''}`.toLowerCase()
  return hay.includes(q)
}

function addLabelFilter(selected: string[], label: string): string[] {
  if (selected.some((item) => sameTopicLabel(item, label))) return selected
  return [...selected, label]
}

function NewspaperFilters({
  query,
  labels,
  selected,
  inChat,
  inChatAvailable,
  read,
  readAvailable,
  showFiltered,
  filteredAvailable,
  filteredCount,
  onQuery,
  onToggle,
  onInChat,
  onRead,
  onShowFiltered,
  onClear,
}: {
  query: string
  labels: string[]
  selected: string[]
  inChat: boolean
  inChatAvailable: boolean
  read: boolean
  readAvailable: boolean
  showFiltered: boolean
  filteredAvailable: boolean
  filteredCount: number
  onQuery: (value: string) => void
  onToggle: (label: string) => void
  onInChat: (value: boolean) => void
  onRead: (value: boolean) => void
  onShowFiltered: (value: boolean) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const hasFilter =
    Boolean(query.trim()) || selected.length > 0 || inChat || read || showFiltered
  const summary = selected.length
    ? selected.map((label) => splitTopicHint(label).term).join(', ')
    : 'All labels'

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="newspaper-filters" ref={rootRef}>
      <label className="newspaper-filter-search">
        <span className="sr-only">Search stories</span>
        <input
          type="search"
          value={query}
          placeholder="Search stories"
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      <div className="newspaper-filter-select">
        <button
          type="button"
          className={open || selected.length ? 'on' : ''}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Filter labels, ${summary}`}
          title={summary}
          disabled={!labels.length}
          onClick={() => setOpen((v) => !v)}
        >
          {summary}
        </button>
        {open && labels.length ? (
          <ul className="newspaper-filter-menu" role="listbox" aria-multiselectable="true" aria-label="Interest labels">
            {labels.map((label) => {
              const checked = selected.some((item) => sameTopicLabel(item, label))
              const text = splitTopicHint(label).term
              return (
                <li key={label.toLowerCase()} role="option" aria-selected={checked}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(label)}
                    />
                    {text}
                  </label>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        className={`newspaper-filter-inchat${inChat ? ' on' : ''}`}
        aria-pressed={inChat}
        disabled={!inChatAvailable && !inChat}
        title={
          inChat
            ? 'Show all stories'
            : 'Show only stories brought up in this chat'
        }
        onClick={() => onInChat(!inChat)}
      >
        In chat
      </button>
      <button
        type="button"
        className={`newspaper-filter-read${read ? ' on' : ''}`}
        aria-pressed={read}
        disabled={!readAvailable && !read}
        title={
          read
            ? 'Show all stories'
            : 'Show only stories loaded into the chat'
        }
        onClick={() => onRead(!read)}
      >
        Read
      </button>
      <button
        type="button"
        className={`newspaper-filter-filtered${showFiltered ? ' on' : ''}`}
        aria-pressed={showFiltered}
        disabled={!filteredAvailable && !showFiltered}
        title={
          showFiltered
            ? 'Hide stories ranked 0 or below'
            : filteredCount
              ? `Show ${filteredCount} ${filteredCount === 1 ? 'story' : 'stories'} ranked 0 or below`
              : 'Show stories ranked 0 or below'
        }
        onClick={() => onShowFiltered(!showFiltered)}
      >
        Filtered
      </button>
      <button
        type="button"
        className="newspaper-filter-clear"
        disabled={!hasFilter}
        onClick={() => {
          onClear()
          setOpen(false)
        }}
      >
        Clear
      </button>
    </div>
  )
}

function speakPreparedText(text: string): boolean {
  const toSpeak = /[.!?]$/.test(text) ? text : `${text}.`
  const { sentences, rest } = takeCompleteSentences(toSpeak)
  for (const s of sentences) enqueueSpeak(s)
  if (rest.trim()) flushSpeak(rest)
  return isTtsBusy() || isTtsPlaying()
}

function weatherScript(item: WebItem): string {
  return (item.spokenText ?? item.blurb).trim()
}

function WeatherSection({ item }: { item: WebItem }) {
  const [speaking, setSpeaking] = useState(false)
  const script = weatherScript(item)

  useEffect(() => {
    if (!speaking) return
    return subscribeTtsActivity(() => {
      if (isTtsBusy() || isTtsPlaying()) return
      setSpeaking(false)
    })
  }, [speaking])

  const onSpeak = () => {
    if (speaking && (isTtsBusy() || isTtsPlaying())) {
      stopTts()
      setSpeaking(false)
      return
    }
    if (!script) return
    if (!getTtsConfig().enabled) {
      setError('Turn on voice in Settings to hear the weather.')
      return
    }
    stopTts()
    setSpeakingArticleUrl(null)
    setTtsSpeaker(getActivePersona())
    setSpeaking(true)
    if (!speakPreparedText(script)) setSpeaking(false)
  }

  return (
    <aside className={`newspaper-weather${speaking ? ' speaking' : ''}`}>
      <div className="newspaper-weather-head">
        <h3>Weather</h3>
        {script ? (
          <button
            type="button"
            className={`news-source-speak${speaking ? ' on' : ''}`}
            title={speaking ? 'Stop reading the forecast' : 'Speak the weather forecast'}
            aria-pressed={speaking}
            onClick={onSpeak}
          >
            {speaking ? 'Stop' : 'Speak'}
          </button>
        ) : null}
      </div>
      <strong>{item.title}</strong>
      {item.forecast?.length ? (
        <ol className="newspaper-weather-days">
          {item.forecast.map((row) => (
            <li key={row.label}>
              <span className="newspaper-weather-day">{row.label}</span>
              <span className="newspaper-weather-cond">{row.condition}</span>
              {row.temp ? (
                <span className="newspaper-weather-temp">{row.temp}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : item.blurb ? (
        <p>{item.blurb}</p>
      ) : null}
    </aside>
  )
}

function StoryGrid({
  children,
  disabled,
}: {
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className={`newspaper-story-grid${disabled ? ' disabled' : ''}`}
      inert={disabled || undefined}
      aria-busy={disabled || undefined}
    >
      {children}
    </div>
  )
}

export function Newspaper() {
  const { newsOpen, messages, speakingMessageId } = useSession()
  const shelf = useArticleShelf()
  const cfg = useWebConfig()
  const profile = useUserProfile()
  const { activeId: profileId } = useProfiles()
  const digest = useWebDigest()
  const [clock, setClock] = useState(() => formatLocalClock())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [storyQuery, setStoryQuery] = useState('')
  const [labelFilters, setLabelFilters] = useState<string[]>([])
  const [inChatOnly, setInChatOnly] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [showFiltered, setShowFiltered] = useState(false)
  const open = newsOpen && cfg.enabled
  const interestTopics = useMemo(
    () => resolveFetchTopics(cfg, profile),
    [cfg, profile],
  )

  useEffect(() => {
    if (!open) setSettingsOpen(false)
  }, [open])

  useEffect(() => {
    setSettingsOpen(false)
    setStoryQuery('')
    setLabelFilters([])
    setInChatOnly(false)
    setReadOnly(false)
    setShowFiltered(false)
  }, [profileId])

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
  const stories = forYouStories(digest.items)
  const chatStories = itemsMentionedInSession(messages)
  const inChatIds = new Set(chatStories.map((item) => item.id))
  const readIds = new Set(
    digest.items
      .filter(
        (item) =>
          Boolean(item.url) &&
          shelf.items.some((article) => sameArticleUrl(article.url, item.url!)),
      )
      .map((item) => item.id),
  )
  const storyPool = (inChatOnly ? chatStories : stories).filter((item) =>
    readOnly ? readIds.has(item.id) : true,
  )
  const storyLabels = collectStoryLabels(stories, interestTopics)
  const matchingStories = storyPool.filter((item) => {
    const label = mainInterestLabel(item, interestTopics)
    if (!storyMatchesQuery(item, storyQuery, label)) return false
    return itemMatchesLabels(item, interestTopics, labelFilters)
  })
  const hiddenStories = matchingStories.filter(isLowConfidenceStory)
  const filteredStories = showFiltered
    ? matchingStories
    : matchingStories.filter((item) => !isLowConfidenceStory(item))
  const speakingMessage = messages.find((m) => m.id === speakingMessageId)
  const speakingIds = new Set(
    speakingMessage
      ? briefingItemsForText(speakingMessage.content).map((item) => item.id)
      : [],
  )
  if (shelf.speakingUrl) {
    const url = shelf.speakingUrl
    for (const item of [...digest.items, ...chatStories]) {
      if (item.url && sameArticleUrl(item.url, url)) speakingIds.add(item.id)
    }
  }
  const fetchedLabel = digest.fetchedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(digest.fetchedAt))
    : null
  const hasStories = weather.length > 0 || stories.length > 0
  const fetching = digest.status === 'fetching'

  return (
    <HudWindow
      open={open}
      label="The Daily Bubble"
      className={`newspaper-paper${fetching ? ' fetching' : ''}`}
      overlayClassName="newspaper-overlay"
      boundsId="newspaper"
      defaultBounds={() =>
        defaultHudBounds({ side: 'left', width: 580, heightRatio: 0.7 })
      }
      header={<span className="hud-win-title">The Daily Bubble</span>}
      trailing={
        <>
          <button
            type="button"
            className={`hud-win-action${settingsOpen ? ' on' : ''}`}
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            Settings
          </button>
          <button
            type="button"
            className="hud-win-action"
            disabled={fetching}
            aria-busy={fetching}
            onClick={() => void ensureWebDigest({ force: true })}
          >
            {fetching ? (
              <>
                <span className="newspaper-fetch-spin" aria-hidden="true" />
                Fetching…
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </>
      }
      onClose={() => setNewsOpen(false)}
    >
      {open && settingsOpen ? (
        <NewspaperSettings
          key={profileId}
          onClose={() => setSettingsOpen(false)}
        />
      ) : open ? (
        <>
          <header className="newspaper-masthead">
        {fetchedLabel ? (
          <p className="newspaper-fetched">Fetched {fetchedLabel}</p>
        ) : null}
        <p className="newspaper-flag">Vol. I · Faces edition</p>
        <h2 id="newspaper-masthead">The Daily Bubble</h2>
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

      {weather.length ? (
        <div className="newspaper-weather-wrap">
          {weather.map((item) => (
            <WeatherSection key={item.id} item={item} />
          ))}
        </div>
      ) : null}

      {stories.length || chatStories.length ? (
        <NewspaperFilters
          query={storyQuery}
          labels={storyLabels}
          selected={labelFilters}
          inChat={inChatOnly}
          inChatAvailable={chatStories.length > 0}
          read={readOnly}
          readAvailable={readIds.size > 0}
          showFiltered={showFiltered}
          filteredAvailable={hiddenStories.length > 0}
          filteredCount={hiddenStories.length}
          onQuery={setStoryQuery}
          onToggle={(label) => {
            setLabelFilters((prev) =>
              prev.some((item) => sameTopicLabel(item, label))
                ? prev.filter((item) => !sameTopicLabel(item, label))
                : [...prev, label],
            )
          }}
          onInChat={setInChatOnly}
          onRead={setReadOnly}
          onShowFiltered={setShowFiltered}
          onClear={() => {
            setStoryQuery('')
            setLabelFilters([])
            setInChatOnly(false)
            setReadOnly(false)
            setShowFiltered(false)
          }}
        />
      ) : null}

      <div className="newspaper-spread">
        {!hasStories && !fetching ? (
          <p className="newspaper-empty">
            No briefing yet. Refresh to fetch today’s headlines.
          </p>
        ) : null}

        {stories.length || chatStories.length ? (
          filteredStories.length ? (
            <StoryGrid disabled={fetching}>
              {packNewspaperStories(filteredStories).map((item) => {
                const label = mainInterestLabel(item, interestTopics)
                return (
                  <Story
                    key={item.id}
                    item={item}
                    mentioned={mentioned}
                    inChat={inChatIds.has(item.id)}
                    read={readIds.has(item.id)}
                    speaking={speakingIds.has(item.id)}
                    label={label}
                    labelActive={Boolean(
                      label &&
                        labelFilters.some((pick) => sameTopicLabel(pick, label)),
                    )}
                    onLabelClick={(next) =>
                      setLabelFilters((prev) => addLabelFilter(prev, next))
                    }
                  />
                )
              })}
            </StoryGrid>
          ) : (
            <p className="newspaper-empty">
              {readOnly && inChatOnly && !storyQuery.trim() && !labelFilters.length && !hiddenStories.length
                ? 'No read stories in this chat.'
                : readOnly && !storyQuery.trim() && !labelFilters.length && !hiddenStories.length
                  ? 'No read stories yet.'
                  : inChatOnly && !storyQuery.trim() && !labelFilters.length && !hiddenStories.length
                    ? 'No stories in this chat yet.'
                    : !showFiltered && hiddenStories.length
                      ? 'Low-interest stories are hidden. Turn on Filtered to see them.'
                      : 'No stories match these filters.'}
            </p>
          )
        ) : null}
      </div>
        </>
      ) : null}
    </HudWindow>
  )
}
