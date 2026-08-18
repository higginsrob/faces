import type { MouseEvent } from 'react'
import { setError } from '../chat/session'
import {
  articleForUrl,
  dropArticle,
  loadArticle,
  sameArticleUrl,
  useArticleShelf,
} from '../web/articles'
import { useWebDigest } from '../web/digest'
import { hostLabel } from '../web/links'
import { openSourceViewer, sourceHostUnframeable } from '../web/viewer'

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
  return hostLabel(url)
}

export function NewsSourceLink({
  url,
  title,
}: {
  url: string
  title?: string
}) {
  const { loadingUrl } = useArticleShelf()
  const digest = useWebDigest()
  const loaded = Boolean(articleForUrl(url))
  const loading = loadingUrl ? sameArticleUrl(loadingUrl, url) : false
  const busy = Boolean(loadingUrl)
  const digestTitle = digest.items.find(
    (item) => item.url && sameArticleUrl(item.url, url),
  )?.title
  const label = titleForUrl(url, title, digestTitle)

  const onRead = () => {
    if (loaded) {
      dropArticle(url)
      return
    }
    void loadArticle(url, { title: label }).catch((e) => {
      if (isAbortError(e)) return
      setError(e instanceof Error ? e.message : String(e))
    })
  }

  const onOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (sourceHostUnframeable(url)) return
    e.preventDefault()
    openSourceViewer({ url, title: label })
  }

  return (
    <div className="news-source">
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
      <button
        type="button"
        className={`news-source-read${loaded ? ' on' : ''}`}
        disabled={!loaded && busy}
        title={
          loaded
            ? 'Remove this article from the chat'
            : 'Load this article into the chat'
        }
        onClick={onRead}
      >
        {loading ? 'Reading…' : loaded ? 'In chat' : 'Read'}
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
}
