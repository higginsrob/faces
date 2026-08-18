import { useEffect, useState } from 'react'
import { testOllamaHost } from '../../ollama/client'
import { patchRerankConfig, useRerankConfig } from '../../ollama/rerankStore'
import { useOllamaConfig } from '../../ollama/store'
import type { OllamaTag } from '../../ollama/types'

export function RerankPanel() {
  const chat = useOllamaConfig()
  const cfg = useRerankConfig()
  const [status, setStatus] = useState<string | null>(null)
  const [ok, setOk] = useState<boolean | null>(null)
  const [tags, setTags] = useState<OllamaTag[]>([])
  const [testing, setTesting] = useState(false)

  const refresh = async () => {
    setTesting(true)
    const result = await testOllamaHost(chat.host)
    setOk(result.ok)
    setStatus(result.detail)
    setTags(result.tags)
    setTesting(false)
  }

  useEffect(() => {
    let cancelled = false
    void testOllamaHost(chat.host).then((result) => {
      if (cancelled) return
      setOk(result.ok)
      setStatus(result.detail)
      setTags(result.tags)
    })
    return () => {
      cancelled = true
    }
  }, [chat.host])

  return (
    <div className="settings-stack">
      <p className="hint">
        Optional second Ollama model that scores today’s headlines for you. It
        uses the Chat Model host. Leave the model empty to rank locally from
        your profile and thumbs. A small, fast model is enough.
      </p>
      <section>
        <h3>Connection</h3>
        <div className="form-grid">
          <label className="span-2">
            Host
            <input value={chat.host} readOnly />
          </label>
          <label className="span-2">
            Model
            <select
              value={cfg.model}
              onChange={(e) => patchRerankConfig({ model: e.target.value })}
            >
              <option value="">None — rank locally</option>
              {cfg.model && !tags.some((t) => t.name === cfg.model) ? (
                <option value={cfg.model}>{cfg.model}</option>
              ) : null}
              {tags.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            keep_alive (-1 forever)
            <input
              value={keepAliveInputValue(cfg.keep_alive)}
              placeholder="5m"
              onChange={(e) =>
                patchRerankConfig({ keep_alive: e.target.value })
              }
            />
          </label>
          <div className="btn-row">
            <button type="button" disabled={testing} onClick={() => void refresh()}>
              {testing ? 'Testing…' : 'Test'}
            </button>
          </div>
        </div>
        {status ? (
          <p className={`status ${ok ? 'ok' : 'bad'}`}>{status}</p>
        ) : null}
      </section>
    </div>
  )
}

function keepAliveInputValue(value: string | number): string {
  return value === -1 ? 'forever' : String(value)
}
