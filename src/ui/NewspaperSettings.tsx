import { useEffect, useRef, useState } from 'react'
import { setSettingsTab } from '../chat/session'
import { ensureWebDigest } from '../web/ensure'
import { patchWebConfig, useWebConfig } from '../web/store'
import {
  digestDraftFromConfig,
  digestDraftsEqual,
  NewsDigestFields,
  type NewsDigestDraft,
} from './settings/NewsDigestFields'

export function NewspaperSettings({ onClose }: { onClose: () => void }) {
  const cfg = useWebConfig()
  const [draft, setDraft] = useState<NewsDigestDraft>(() =>
    digestDraftFromConfig(cfg),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const saved = digestDraftFromConfig(cfg)
  const dirty = !digestDraftsEqual(draft, saved)
  const jinaReady = Boolean(cfg.jinaApiKey.trim())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('.guide-overlay, .topic-conflict-overlay')) return
      e.preventDefault()
      e.stopPropagation()
      if (confirmOpen) setConfirmOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', onKey, true)
    if (confirmOpen) confirmRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [confirmOpen, onClose])

  const save = () => {
    patchWebConfig({
      sources: draft.sources,
      topics: draft.topics,
      ignoreTopics: draft.ignoreTopics,
    })
    setConfirmOpen(false)
    onClose()
    void ensureWebDigest({ force: true })
  }

  return (
    <div className="newspaper-settings settings-stack">
      {!jinaReady ? (
        <p className="newspaper-jina-note">
          Local and topic headlines need a Jina API key.{' '}
          <button
            type="button"
            className="newspaper-settings-link"
            onClick={() => setSettingsTab('news')}
          >
            Open Settings → News
          </button>{' '}
          to add one. National news can still use Wikipedia without a key.
        </p>
      ) : null}

      <NewsDigestFields value={draft} onChange={setDraft} />

      <div className="newspaper-settings-save">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="newspaper-settings-save-btn"
          disabled={!dirty}
          onClick={() => setConfirmOpen(true)}
        >
          Save
        </button>
      </div>

      {confirmOpen ? (
        <div
          className="lightbox-overlay newspaper-confirm"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false)
          }}
        >
          <div
            className="lightbox-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="newspaper-replace-title"
          >
            <header className="lightbox-head">
              <h2 id="newspaper-replace-title">Replace today’s stories?</h2>
            </header>
            <p className="hint">
              Saving these settings refreshes the newspaper and replaces the
              current articles.
            </p>
            <div className="lightbox-actions">
              <button type="button" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                ref={confirmRef}
                type="button"
                className="lightbox-close"
                onClick={save}
              >
                Replace articles
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
