import { useEffect, useMemo, useState } from 'react'
import { getActivePersona } from '../../personas/store'
import {
  listUsableBrowserTtsVoices,
  subscribeVoicesChanged,
} from '../../voice/browserTts'
import {
  listOmniVoices,
  testOmniVoice,
  type OmniVoice,
} from '../../voice/omniVoice'
import { enqueueSpeak, setTtsSpeaker, stopTts } from '../../voice/tts'
import {
  patchTtsConfig,
  useTtsConfig,
  type TtsEngine,
} from '../../voice/ttsStore'

export function VoicePanel() {
  const cfg = useTtsConfig()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [omniVoices, setOmniVoices] = useState<OmniVoice[]>([])
  const [omniStatus, setOmniStatus] = useState<string | null>(null)
  const [omniOk, setOmniOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => setVoices(listUsableBrowserTtsVoices())
    sync()
    return subscribeVoicesChanged(sync)
  }, [])

  const englishFirst = useMemo(() => voices, [voices])

  const refreshOmni = async () => {
    setBusy(true)
    const result = await testOmniVoice(cfg.omniHost)
    setOmniOk(result.ok)
    setOmniStatus(result.detail)
    if (result.ok) {
      try {
        setOmniVoices(await listOmniVoices(cfg.omniHost))
      } catch (e) {
        setOmniVoices([])
        setOmniOk(false)
        setOmniStatus(e instanceof Error ? e.message : String(e))
      }
    } else {
      setOmniVoices([])
    }
    setBusy(false)
  }

  useEffect(() => {
    if (cfg.engine !== 'omnivoice') return
    let cancelled = false
    void (async () => {
      setBusy(true)
      const result = await testOmniVoice(cfg.omniHost)
      if (cancelled) return
      setOmniOk(result.ok)
      setOmniStatus(result.detail)
      if (result.ok) {
        try {
          const list = await listOmniVoices(cfg.omniHost)
          if (!cancelled) setOmniVoices(list)
        } catch (e) {
          if (cancelled) return
          setOmniVoices([])
          setOmniOk(false)
          setOmniStatus(e instanceof Error ? e.message : String(e))
        }
      } else {
        setOmniVoices([])
      }
      setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [cfg.engine, cfg.omniHost])

  return (
    <div className="settings-stack">
      <label className="check">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => {
            const enabled = e.target.checked
            patchTtsConfig({ enabled })
            if (!enabled) stopTts()
          }}
        />
        Speak replies
      </label>
      <label>
        Engine
        <select
          value={cfg.engine}
          onChange={(e) =>
            patchTtsConfig({ engine: e.target.value as TtsEngine })
          }
        >
          <option value="browser">Browser voices (default)</option>
          <option value="omnivoice">OmniVoice host</option>
        </select>
      </label>

      {cfg.engine === 'browser' ? (
        <label>
          Voice
          <select
            value={cfg.browserVoiceURI ?? ''}
            onChange={(e) =>
              patchTtsConfig({
                browserVoiceURI: e.target.value || null,
              })
            }
          >
            <option value="">Auto (local English if possible)</option>
            {englishFirst.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang}){v.localService ? '' : ' · network'}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label>
            OmniVoice host
            <input
              value={cfg.omniHost}
              placeholder="http://127.0.0.1:8880"
              onChange={(e) => patchTtsConfig({ omniHost: e.target.value })}
            />
          </label>
          <label>
            Model
            <input
              value={cfg.omniModel}
              onChange={(e) => patchTtsConfig({ omniModel: e.target.value })}
            />
          </label>
          <label>
            Voice
            <select
              value={cfg.omniVoice}
              onChange={(e) => patchTtsConfig({ omniVoice: e.target.value })}
            >
              <option value="auto">auto (Voice Designer)</option>
              {cfg.omniVoice &&
              cfg.omniVoice !== 'auto' &&
              !omniVoices.some((v) => v.id === cfg.omniVoice) ? (
                <option value={cfg.omniVoice}>{cfg.omniVoice}</option>
              ) : null}
              {omniVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name ?? v.id}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Age, gender, and accent are set on each face under Personas.
            OmniVoice uses that face&apos;s settings when it speaks.
          </p>
          <div className="btn-row">
            <button type="button" disabled={busy} onClick={() => void refreshOmni()}>
              {busy ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {omniStatus ? (
            <p className={`status ${omniOk ? 'ok' : 'bad'}`}>{omniStatus}</p>
          ) : null}
        </>
      )}

      <div className="btn-row">
        <button
          type="button"
          onClick={() => {
            stopTts()
            setTtsSpeaker(getActivePersona())
            enqueueSpeak('Hello. This is a voice test from Faces.')
          }}
        >
          Speak test line
        </button>
      </div>
    </div>
  )
}
