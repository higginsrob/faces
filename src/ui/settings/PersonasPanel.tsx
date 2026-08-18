import { useState } from 'react'
import { EMOTIONS } from '../../emotions/catalog'
import { copyPersonaLink } from '../../personas/query'
import {
  addPersona,
  deletePersona,
  duplicatePersona,
  restoreBuiltins,
  updatePersona,
  usePersonas,
} from '../../personas/store'
import { switchPersona } from '../../chat/session'
import type { Persona } from '../../personas/types'
import {
  VOICE_ACCENT_OPTIONS,
  VOICE_AGE_OPTIONS,
  VOICE_GENDER_OPTIONS,
  type VoiceAccent,
  type VoiceAge,
  type VoiceGender,
} from '../../voice/ttsStore'

export function PersonasPanel() {
  const { personas, activeId } = usePersonas()
  const selected = personas.find((p) => p.id === activeId) ?? personas[0]!
  const [copied, setCopied] = useState(false)

  return (
    <div className="settings-stack">
      <p className="hint">
        Each built-in face is a persona. Auto in the talk bar picks who
        answers each message; lock a face there to stay with one. Switch
        here to edit.
      </p>
      <div className="persona-list">
        {personas.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`persona-chip ${p.id === selected.id ? 'active' : ''}`}
            onClick={() => switchPersona(p.id)}
          >
            <span className="chip-orb" style={{ background: p.sphereColor }}>
              {p.defaultFace}
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button
          type="button"
          onClick={() => {
            const p = addPersona()
            switchPersona(p.id)
          }}
        >
          New
        </button>
        <button
          type="button"
          onClick={() => {
            const p = duplicatePersona(selected.id)
            if (p) switchPersona(p.id)
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          aria-label="Copy shareable link to this persona"
          onClick={() => {
            void copyPersonaLink(selected)
              .then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              })
              .catch(() => {})
          }}
        >
          {copied ? 'Copied' : 'Copy persona'}
        </button>
        <button
          type="button"
          disabled={personas.length <= 1}
          onClick={() => {
            const remaining = personas.find((p) => p.id !== selected.id)
            deletePersona(selected.id)
            if (remaining) switchPersona(remaining.id)
          }}
        >
          Delete
        </button>
        <button type="button" onClick={() => restoreBuiltins()}>
          Restore built-ins
        </button>
      </div>
      <PersonaEditor persona={selected} />
    </div>
  )
}

function PersonaEditor({ persona }: { persona: Persona }) {
  const set = (patch: Partial<Persona>) => updatePersona(persona.id, patch)

  return (
    <div className="form-grid">
      <label>
        Name
        <input
          value={persona.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label>
        Sphere color
        <input
          type="color"
          value={persona.sphereColor}
          onChange={(e) => set({ sphereColor: e.target.value })}
        />
      </label>
      <label>
        Face
        <select
          value={persona.defaultFace}
          onChange={(e) => set({ defaultFace: e.target.value })}
        >
          {EMOTIONS.map((e) => (
            <option key={e.id} value={e.emoji}>
              {e.emoji} {e.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint span-2">
        OmniVoice uses this face&apos;s gender, age, and accent when that
        engine is selected.
      </p>
      <label>
        Gender
        <select
          value={persona.voiceGender}
          onChange={(e) =>
            set({ voiceGender: e.target.value as VoiceGender })
          }
        >
          {VOICE_GENDER_OPTIONS.map((o) => (
            <option key={o.value || 'default'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Age
        <select
          value={persona.voiceAge}
          onChange={(e) => set({ voiceAge: e.target.value as VoiceAge })}
        >
          {VOICE_AGE_OPTIONS.map((o) => (
            <option key={o.value || 'default'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Accent
        <select
          value={persona.voiceAccent}
          onChange={(e) =>
            set({ voiceAccent: e.target.value as VoiceAccent })
          }
        >
          {VOICE_ACCENT_OPTIONS.map((o) => (
            <option key={o.value || 'default'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="span-2">
        System prompt
        <textarea
          rows={7}
          value={persona.systemPrompt}
          onChange={(e) => set({ systemPrompt: e.target.value })}
        />
      </label>
    </div>
  )
}
