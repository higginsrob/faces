import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { setError } from '../chat/session'
import { getActivePersona } from '../personas/store'
import { takeCompleteSentences } from '../voice/spokenText'
import { getTtsConfig } from '../voice/ttsStore'
import {
  enqueueSpeak,
  flushSpeak,
  isTtsBusy,
  isTtsPlaying,
  setTtsSpeaker,
  stopTts,
} from '../voice/tts'
import {
  articleForUrl,
  dropArticle,
  ensureSpokenSummary,
  isDroppedSourceUrl,
  itemForSourceUrl,
  loadArticle,
  restoreDroppedSourceUrl,
  sameArticleUrl,
  setSpeakingArticleUrl,
  useArticleShelf,
} from '../web/articles'
import { useWebDigest } from '../web/digest'
import { hostLabel } from '../web/links'
import { openSourceViewer, sourceHostUnframeable } from '../web/viewer'
import { isYouTubeUrl, youtubeEmbedSrc } from '../web/youtube'
import { StoryVotes } from './StoryVotes'

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

function titleForUrl(
  url: string,
  title: string | undefined,
  digestTitle: string | undefined,
): string {
  const explicit = title?.trim()
  if (explicit) return explicit
  const loaded = articleForUrl(url)?.title.trim()
  if (loaded) return loaded
  if (digestTitle?.trim()) return digestTitle.trim()
  if (isYouTubeUrl(url)) return 'YouTube'
  return hostLabel(url)
}

function speakSummary(text: string): boolean {
  const toSpeak = /[.!?]$/.test(text) ? text : `${text}.`
  const { sentences, rest } = takeCompleteSentences(toSpeak)
  for (const s of sentences) enqueueSpeak(s)
  if (rest.trim()) flushSpeak(rest)
  return isTtsBusy() || isTtsPlaying()
}

export function NewsSourceLink({
  url,
  title,
  votes = true,
}: {
  url: string
  title?: string
  votes?: boolean
}) {
  const shelf = useArticleShelf()
  const digest = useWebDigest()
  const article = shelf.items.find((item) => sameArticleUrl(item.url, url))
  const loaded = Boolean(article)
  const dropped = !loaded && isDroppedSourceUrl(url)
  const spokenSummary = article?.spokenSummary?.trim() ?? ''
  const speaking =
    Boolean(shelf.speakingUrl) && sameArticleUrl(shelf.speakingUrl!, url)
  const loading = shelf.loadingUrl ? sameArticleUrl(shelf.loadingUrl, url) : false
  const busy = Boolean(shelf.loadingUrl)
  const digestTitle = digest.items.find(
    (item) => item.url && sameArticleUrl(item.url, url),
  )?.title
  const label = titleForUrl(url, title, digestTitle)

  useEffect(() => {
    if (!loaded || spokenSummary || loading) return
    ensureSpokenSummary(url)
  }, [loaded, spokenSummary, loading, url])

  const onRead = () => {
    if (loaded) {
      dropArticle(url)
      return
    }
    if (dropped) restoreDroppedSourceUrl(url)
    void loadArticle(url, {
      title: label,
      waitForSummary: true,
      force: true,
    }).catch((e) => {
      if (isAbortError(e)) return
      setError(e instanceof Error ? e.message : String(e))
    })
  }

  const onSpeak = () => {
    if (speaking && (isTtsBusy() || isTtsPlaying())) {
      stopTts()
      setSpeakingArticleUrl(null)
      return
    }
    if (!spokenSummary) return
    if (!getTtsConfig().enabled) {
      setError('Turn on voice in Settings to hear the summary.')
      return
    }
    stopTts()
    setTtsSpeaker(getActivePersona())
    setSpeakingArticleUrl(url)
    if (!speakSummary(spokenSummary)) setSpeakingArticleUrl(null)
  }

  const youtube = isYouTubeUrl(url)
  const voteItem = votes ? itemForSourceUrl(url, label) : null

  const onOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (!youtubeEmbedSrc(url) && sourceHostUnframeable(url)) return
    e.preventDefault()
    openSourceViewer({ url, title: label })
  }

  const row = (buttons?: ReactNode) => (
    <div className={`news-source${youtube ? ' is-youtube' : ''}`}>
      {youtube ? (
        <span className="news-source-yt" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path
              fill="currentColor"
              d="M8 6.8v10.4L18 12 8 6.8Z"
            />
          </svg>
          YouTube
        </span>
      ) : null}
      <a
        className="news-source-title"
        href={url}
        target="_blank"
        rel="noreferrer"
        title={label}
        onClick={onOpen}
      >
        {label}
      </a>
      {spokenSummary && !loading ? (
        <button
          type="button"
          className={`news-source-speak${speaking ? ' on' : ''}`}
          title={speaking ? 'Stop reading the summary' : 'Speak the article summary'}
          aria-pressed={speaking}
          onClick={onSpeak}
        >
          {speaking ? 'Stop' : 'Speak'}
        </button>
      ) : null}
      {buttons}
      <button
        type="button"
        className={`news-source-read${loaded ? ' on' : ''}${dropped ? ' dropped' : ''}`}
        disabled={!loaded && busy}
        title={
          dropped
            ? 'This source was dropped. Click to restore it so you can read it again.'
            : loaded
              ? youtube
                ? 'Remove this transcript from the chat'
                : 'Remove this article from the chat'
              : youtube
                ? 'Load this video transcript into the chat'
                : 'Load this article into the chat'
        }
        onClick={onRead}
      >
        {loading ? 'Reading…' : loaded ? 'Drop' : dropped ? 'Dropped' : 'Read'}
      </button>
      <a
        className="news-source-open"
        href={url}
        target="_blank"
        rel="noreferrer"
        title="Open this page in a new tab"
      >
        Open
      </a>
    </div>
  )

  if (!voteItem) return row()

  return (
    <StoryVotes item={voteItem} compact>
      {({ buttons, panel }) => (
        <>
          {row(buttons)}
          {panel}
        </>
      )}
    </StoryVotes>
  )
}
