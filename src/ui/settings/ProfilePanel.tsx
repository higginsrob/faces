import { useRef, useState } from 'react'
import { EMOTIONS } from '../../emotions/catalog'
import {
  downloadProfilesExport,
  readProfilesFile,
} from '../../profile/export'
import {
  addProfile,
  deleteProfile,
  duplicateProfile,
  importProfiles,
  patchActiveLabel,
  patchActiveNewsPrefs,
  patchUserProfile,
  resetActiveProfile,
  setActiveProfile,
  useProfiles,
} from '../../profile/store'
import {
  EDUCATION_LEVELS,
  profileDisplayLabel,
  TALK_STYLES,
  type UserProfile,
} from '../../profile/types'
import {
  digestDraftFromConfig,
  NewsDigestFields,
} from './NewsDigestFields'
import { useWebConfig } from '../../web/store'

export function ProfilePanel() {
  const { profiles, activeId } = useProfiles()
  const cfg = useWebConfig()
  const selected = profiles.find((p) => p.id === activeId) ?? profiles[0]!
  const profile = selected.user
  const fileRef = useRef<HTMLInputElement>(null)
  const [importNote, setImportNote] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const set = (patch: Partial<UserProfile>) => patchUserProfile(patch)
  const moodKnown = !profile.mood || EMOTIONS.some((e) => e.emoji === profile.mood)
  const educationKnown =
    !profile.education ||
    (EDUCATION_LEVELS as readonly string[]).includes(profile.education)
  const talkKnown =
    !profile.talkStyle || TALK_STYLES.some((s) => s.value === profile.talkStyle)

  const onImportFile = (file: File | undefined) => {
    if (!file) return
    void readProfilesFile(file).then((parsed) => {
      if (!parsed.ok) {
        setImportNote({ ok: false, text: parsed.error })
        return
      }
      const result = importProfiles(parsed.profiles)
      const n = result.added + result.updated
      setImportNote({
        ok: true,
        text: n === 1 ? 'Imported 1 profile.' : `Imported ${n} profiles.`,
      })
    })
  }

  return (
    <div className="settings-stack">
      <p className="hint">
        Profiles stay on this device. Each one has its own identity, news
        topics, and chat. Select a profile to use and edit it. Export JSON
        to back them up or copy them into another install.
      </p>
      <div className="persona-list">
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`persona-chip profile-chip ${p.id === selected.id ? 'active' : ''}`}
            onClick={() => setActiveProfile(p.id)}
          >
            {profileDisplayLabel(p)}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button type="button" onClick={() => addProfile()}>
          New
        </button>
        <button type="button" onClick={() => duplicateProfile(selected.id)}>
          Duplicate
        </button>
        <button
          type="button"
          disabled={profiles.length <= 1}
          onClick={() => deleteProfile(selected.id)}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => downloadProfilesExport([selected], 'one')}
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => downloadProfilesExport(profiles, 'all')}
        >
          Export all
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Import profiles from JSON"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            onImportFile(file)
          }}
        />
      </div>
      {importNote ? (
        <p className={`status ${importNote.ok ? 'ok' : 'bad'}`} role="status">
          {importNote.text}
        </p>
      ) : null}
      <div className="form-grid">
        <label className="span-2">
          Profile name
          <input
            value={selected.label}
            placeholder="e.g. Work, Weekend"
            onChange={(e) => patchActiveLabel(e.target.value)}
          />
        </label>
        <label>
          Name
          <input
            value={profile.name}
            placeholder="What should they call you?"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label>
          Mood
          <select
            value={profile.mood}
            onChange={(e) => set({ mood: e.target.value })}
          >
            <option value="">—</option>
            {profile.mood && !moodKnown ? (
              <option value={profile.mood}>{profile.mood}</option>
            ) : null}
            {EMOTIONS.map((e) => (
              <option key={e.id} value={e.emoji}>
                {e.emoji} {e.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Age
          <input
            value={profile.age}
            inputMode="numeric"
            placeholder="e.g. 8"
            onChange={(e) => set({ age: e.target.value })}
          />
        </label>
        <label>
          Gender
          <input
            value={profile.gender}
            onChange={(e) => set({ gender: e.target.value })}
          />
        </label>
        <label>
          Accent
          <input
            value={profile.accent}
            placeholder="e.g. Southern, British"
            onChange={(e) => set({ accent: e.target.value })}
          />
        </label>
        <label>
          Location
          <input
            value={profile.location}
            placeholder="City, region, or country"
            onChange={(e) => set({ location: e.target.value })}
          />
        </label>
        <label>
          Title
          <input
            value={profile.title}
            placeholder="Job, role, or how you like to be addressed"
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label>
          Education
          <select
            value={profile.education}
            onChange={(e) => set({ education: e.target.value })}
          >
            <option value="">—</option>
            {profile.education && !educationKnown ? (
              <option value={profile.education}>{profile.education}</option>
            ) : null}
            {EDUCATION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          How you like to talk
          <select
            value={profile.talkStyle}
            onChange={(e) => set({ talkStyle: e.target.value })}
          >
            <option value="">—</option>
            {profile.talkStyle && !talkKnown ? (
              <option value={profile.talkStyle}>{profile.talkStyle}</option>
            ) : null}
            {TALK_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Household
          <input
            value={profile.household}
            placeholder="Partner, kids, pets, roommates"
            onChange={(e) => set({ household: e.target.value })}
          />
        </label>
        <label>
          Religion
          <input
            value={profile.religion}
            placeholder="Optional — however you describe it"
            onChange={(e) => set({ religion: e.target.value })}
          />
        </label>
        <label>
          Politics
          <input
            value={profile.politics}
            placeholder="Optional — however you describe it"
            onChange={(e) => set({ politics: e.target.value })}
          />
        </label>
        <label className="span-2">
          Interests
          <textarea
            rows={5}
            value={profile.interests}
            placeholder="Anything else they should know — hobbies, work, preferences, facts"
            onChange={(e) => set({ interests: e.target.value })}
          />
        </label>
      </div>
      <NewsDigestFields
        value={digestDraftFromConfig(cfg)}
        onChange={(next) => patchActiveNewsPrefs(next)}
      />
      <div className="btn-row">
        <button type="button" onClick={() => resetActiveProfile()}>
          Clear profile
        </button>
      </div>
    </div>
  )
}
