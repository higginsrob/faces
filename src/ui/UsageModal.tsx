import { useEffect, useRef, useState } from 'react'
import { downloadChatLog } from '../chat/export'
import {
  clearChat,
  setUsageOpen,
  useSession,
} from '../chat/session'
import {
  friendlyOllamaError,
  showOllamaModel,
  type OllamaModelMeta,
} from '../ollama/client'
import { useOllamaConfig } from '../ollama/store'

export function UsageModal() {
  const { usageOpen, lastUsage, usedTokens, messages, face, streaming, error } =
    useSession()
  const ollama = useOllamaConfig()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [meta, setMeta] = useState<OllamaModelMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)

  useEffect(() => {
    if (!usageOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUsageOpen(false)
    }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [usageOpen])

  useEffect(() => {
    if (!usageOpen) return
    if (!ollama.model) {
      setMeta(null)
      setMetaError(null)
      setMetaLoading(false)
      return
    }
    let cancelled = false
    setMetaLoading(true)
    setMetaError(null)
    void showOllamaModel(ollama.model, ollama.host)
      .then((next) => {
        if (cancelled) return
        setMeta(next)
        setMetaLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setMeta(null)
        setMetaError(friendlyOllamaError(e))
        setMetaLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [usageOpen, ollama.model, ollama.host])

  if (!usageOpen) return null

  const ctxLimit = Math.max(1, ollama.options.num_ctx)
  const ctxUsed = Math.max(0, usedTokens)
  const ctxPct = Math.round(Math.min(1, ctxUsed / ctxLimit) * 100)
  const canClear = messages.length > 0
  const totalTokens = lastUsage
    ? lastUsage.promptTokens + lastUsage.completionTokens
    : null

  return (
    <div
      className="lightbox-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) setUsageOpen(false)
      }}
    >
      <div
        className="lightbox-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-title"
      >
        <header className="lightbox-head">
          <h2 id="usage-title">Usage</h2>
        </header>

        <section className="usage-section">
          <h3>Model</h3>
          <dl className="usage-dl">
            <Row label="Name" value={ollama.model || 'None selected'} />
            <Row label="Host" value={ollama.host} />
            <Row
              label="Context"
              value={`${ctxUsed.toLocaleString()} / ${ctxLimit.toLocaleString()} (${ctxPct}%)`}
            />
            <Row label="Temperature" value={formatNumber(ollama.options.temperature)} />
            <Row label="Reasoning" value={ollama.think} />
            <Row label="Keep alive" value={keepAliveLabel(ollama.keep_alive)} />
            {metaLoading ? (
              <Row label="Details" value="Loading…" />
            ) : meta ? (
              <>
                {meta.family ? <Row label="Family" value={meta.family} /> : null}
                {meta.parameterSize || meta.parameterCount != null ? (
                  <Row
                    label="Parameters"
                    value={
                      meta.parameterSize ??
                      formatCompactCount(meta.parameterCount!)
                    }
                  />
                ) : null}
                {meta.quantization ? (
                  <Row label="Quantization" value={meta.quantization} />
                ) : null}
                {meta.format ? <Row label="Format" value={meta.format} /> : null}
                {meta.contextLength != null ? (
                  <Row
                    label="Native context"
                    value={meta.contextLength.toLocaleString()}
                  />
                ) : null}
                {meta.capabilities.length ? (
                  <Row
                    label="Capabilities"
                    value={meta.capabilities.join(', ')}
                  />
                ) : null}
              </>
            ) : metaError ? (
              <Row label="Details" value={metaError} />
            ) : null}
          </dl>
        </section>

        <section className="usage-section">
          <h3>Last message</h3>
          {lastUsage ? (
            <dl className="usage-dl">
              {lastUsage.model ? (
                <Row label="Model" value={lastUsage.model} />
              ) : null}
              <Row
                label="Prompt"
                value={`${lastUsage.promptTokens.toLocaleString()} tokens`}
              />
              <Row
                label="Completion"
                value={`${lastUsage.completionTokens.toLocaleString()} tokens`}
              />
              {totalTokens != null ? (
                <Row
                  label="Total"
                  value={`${totalTokens.toLocaleString()} tokens`}
                />
              ) : null}
              {lastUsage.promptEvalDurationNs != null ? (
                <Row
                  label="Prompt eval"
                  value={formatDurationNs(lastUsage.promptEvalDurationNs)}
                />
              ) : null}
              {lastUsage.evalDurationNs != null ? (
                <Row
                  label="Generation"
                  value={formatDurationNs(lastUsage.evalDurationNs)}
                />
              ) : null}
              {lastUsage.loadDurationNs != null ? (
                <Row
                  label="Load"
                  value={formatDurationNs(lastUsage.loadDurationNs)}
                />
              ) : null}
              {lastUsage.totalDurationNs != null ? (
                <Row
                  label="Total time"
                  value={formatDurationNs(lastUsage.totalDurationNs)}
                />
              ) : null}
              {lastUsage.promptEvalDurationNs != null ? (
                <Row
                  label="Prompt speed"
                  value={formatTokPerSec(
                    lastUsage.promptTokens,
                    lastUsage.promptEvalDurationNs,
                  )}
                />
              ) : null}
              {lastUsage.evalDurationNs != null ? (
                <Row
                  label="Generation speed"
                  value={formatTokPerSec(
                    lastUsage.completionTokens,
                    lastUsage.evalDurationNs,
                  )}
                />
              ) : null}
            </dl>
          ) : (
            <p className="hint">
              Send a message to see token counts and timing from Ollama.
            </p>
          )}
        </section>

        <div className="lightbox-actions">
          <button
            type="button"
            disabled={!canClear}
            onClick={() => clearChat()}
          >
            Clear chat
          </button>
          <button
            type="button"
            onClick={() =>
              downloadChatLog({
                messages,
                face,
                streaming,
                error,
                usedTokens,
                lastUsage,
                ollama,
                model: meta,
              })
            }
          >
            Save chat
          </button>
          <button
            ref={closeRef}
            type="button"
            className="lightbox-close"
            onClick={() => setUsageOpen(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function keepAliveLabel(value: string | number): string {
  return value === -1 ? 'forever' : String(value)
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toString()
}

function formatCompactCount(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n.toLocaleString()
}

function formatDurationNs(ns: number): string {
  const ms = ns / 1e6
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatTokPerSec(count: number, durationNs: number): string {
  if (!durationNs || durationNs <= 0 || count <= 0) return '—'
  return `${(count / (durationNs / 1e9)).toFixed(1)} tok/s`
}
