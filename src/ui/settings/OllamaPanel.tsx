import { useEffect, useState } from 'react'
import { testOllamaHost } from '../../ollama/client'
import { OLLAMA_THINK_LEVELS } from '../../ollama/defaults'
import {
  patchOllamaConfig,
  patchOllamaOptions,
  resetOllamaOptions,
  useOllamaConfig,
} from '../../ollama/store'
import type { OllamaOptions, OllamaTag, OllamaThink } from '../../ollama/types'

export function OllamaPanel() {
  const cfg = useOllamaConfig()
  const [status, setStatus] = useState<string | null>(null)
  const [ok, setOk] = useState<boolean | null>(null)
  const [tags, setTags] = useState<OllamaTag[]>([])
  const [testing, setTesting] = useState(false)

  const refresh = async () => {
    setTesting(true)
    const result = await testOllamaHost(cfg.host)
    setOk(result.ok)
    setStatus(result.detail)
    setTags(result.tags)
    setTesting(false)
    if (result.ok && !cfg.model && result.tags[0]) {
      patchOllamaConfig({ model: result.tags[0].name })
    }
  }

  useEffect(() => {
    let cancelled = false
    void testOllamaHost(cfg.host).then((result) => {
      if (cancelled) return
      setOk(result.ok)
      setStatus(result.detail)
      setTags(result.tags)
      if (result.ok && !cfg.model && result.tags[0]) {
        patchOllamaConfig({ model: result.tags[0].name })
      }
    })
    return () => {
      cancelled = true
    }
  }, [cfg.host, cfg.model])

  const o = cfg.options
  const setO = (patch: Partial<OllamaOptions>) => patchOllamaOptions(patch)

  return (
    <div className="settings-stack">
      <p className="hint">
        This model is used for chat, speaker routing, and briefing blurbs.
      </p>
      <section>
        <h3>Connection</h3>
        <div className="form-grid">
          <label className="span-2">
            Host
            <input
              value={cfg.host}
              placeholder="http://127.0.0.1:11434"
              onChange={(e) => patchOllamaConfig({ host: e.target.value })}
            />
          </label>
          <label className="span-2">
            Model
            <select
              value={cfg.model}
              onChange={(e) => patchOllamaConfig({ model: e.target.value })}
            >
              <option value="">Select a model</option>
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
                patchOllamaConfig({ keep_alive: e.target.value })
              }
            />
          </label>
          <label>
            Reasoning
            <select
              value={cfg.think}
              onChange={(e) =>
                patchOllamaConfig({ think: e.target.value as OllamaThink })
              }
            >
              {OLLAMA_THINK_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <div className="btn-row">
            <button type="button" disabled={testing} onClick={() => void refresh()}>
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button
              type="button"
              onClick={() => resetOllamaOptions()}
            >
              Reset options
            </button>
          </div>
        </div>
        {status ? (
          <p className={`status ${ok ? 'ok' : 'bad'}`}>{status}</p>
        ) : null}
      </section>

      <section>
        <h3>Sampling</h3>
        <div className="form-grid nums">
          <Num label="temperature" value={o.temperature} step={0.05} onChange={(v) => setO({ temperature: v })} />
          <Num label="top_k" value={o.top_k} step={1} onChange={(v) => setO({ top_k: v })} />
          <Num label="top_p" value={o.top_p} step={0.05} onChange={(v) => setO({ top_p: v })} />
          <Num label="min_p" value={o.min_p} step={0.05} onChange={(v) => setO({ min_p: v })} />
          <Num label="typical_p" value={o.typical_p} step={0.05} onChange={(v) => setO({ typical_p: v })} />
          <Num label="seed (-1 random)" value={o.seed} step={1} onChange={(v) => setO({ seed: v })} />
          <Num label="num_predict" value={o.num_predict} step={1} onChange={(v) => setO({ num_predict: v })} />
          <Num label="num_keep" value={o.num_keep} step={1} onChange={(v) => setO({ num_keep: v })} />
        </div>
      </section>

      <section>
        <h3>Penalties</h3>
        <div className="form-grid nums">
          <Num label="repeat_penalty" value={o.repeat_penalty} step={0.05} onChange={(v) => setO({ repeat_penalty: v })} />
          <Num label="repeat_last_n" value={o.repeat_last_n} step={1} onChange={(v) => setO({ repeat_last_n: v })} />
          <Num label="presence_penalty" value={o.presence_penalty} step={0.05} onChange={(v) => setO({ presence_penalty: v })} />
          <Num label="frequency_penalty" value={o.frequency_penalty} step={0.05} onChange={(v) => setO({ frequency_penalty: v })} />
          <label className="check">
            <input
              type="checkbox"
              checked={o.penalize_newline}
              onChange={(e) => setO({ penalize_newline: e.target.checked })}
            />
            penalize_newline
          </label>
          <label className="span-2">
            stop (one per line)
            <textarea
              rows={3}
              value={o.stop.join('\n')}
              onChange={(e) =>
                setO({
                  stop: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </section>

      <section>
        <h3>Mirostat</h3>
        <div className="form-grid nums">
          <Num label="mirostat (0/1/2)" value={o.mirostat} step={1} onChange={(v) => setO({ mirostat: v })} />
          <Num label="mirostat_tau" value={o.mirostat_tau} step={0.1} onChange={(v) => setO({ mirostat_tau: v })} />
          <Num label="mirostat_eta" value={o.mirostat_eta} step={0.05} onChange={(v) => setO({ mirostat_eta: v })} />
        </div>
      </section>

      <section>
        <h3>Runtime</h3>
        <div className="form-grid nums">
          <Num label="num_ctx" value={o.num_ctx} step={256} onChange={(v) => setO({ num_ctx: v })} />
          <Num label="num_batch" value={o.num_batch} step={16} onChange={(v) => setO({ num_batch: v })} />
          <Num label="num_gpu (-1 default)" value={o.num_gpu} step={1} onChange={(v) => setO({ num_gpu: v })} />
          <Num label="main_gpu" value={o.main_gpu} step={1} onChange={(v) => setO({ main_gpu: v })} />
          <Num label="num_thread (0 auto)" value={o.num_thread} step={1} onChange={(v) => setO({ num_thread: v })} />
          <label className="check">
            <input
              type="checkbox"
              checked={o.numa}
              onChange={(e) => setO({ numa: e.target.checked })}
            />
            numa
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={o.use_mmap}
              onChange={(e) => setO({ use_mmap: e.target.checked })}
            />
            use_mmap
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={o.use_mlock}
              onChange={(e) => setO({ use_mlock: e.target.checked })}
            />
            use_mlock
          </label>
        </div>
        <p className="hint">
          Defaults match Ollama’s Modelfile parameters. seed -1, num_gpu -1, and
          num_thread 0 are omitted from the request so the server chooses.
        </p>
      </section>
    </div>
  )
}

function Num({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function keepAliveInputValue(value: string | number): string {
  return value === -1 ? 'forever' : String(value)
}
