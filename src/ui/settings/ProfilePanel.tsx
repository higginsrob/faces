import { EMOTIONS } from '../../emotions/catalog'
import { patchUserProfile, resetUserProfile, useUserProfile } from '../../profile/store'
import {
  EDUCATION_LEVELS,
  TALK_STYLES,
  type UserProfile,
} from '../../profile/types'

export function ProfilePanel() {
  const profile = useUserProfile()
  const set = (patch: Partial<UserProfile>) => patchUserProfile(patch)
  const moodKnown = !profile.mood || EMOTIONS.some((e) => e.emoji === profile.mood)
  const educationKnown =
    !profile.education ||
    (EDUCATION_LEVELS as readonly string[]).includes(profile.education)
  const talkKnown =
    !profile.talkStyle || TALK_STYLES.some((s) => s.value === profile.talkStyle)

  return (
    <div className="settings-stack">
      <p className="hint">
        Optional. Anything you fill in stays on this device and is given to every
        assistant as context, so they can talk to you in a way that fits.
      </p>
      <div className="form-grid">
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
      <div className="btn-row">
        <button type="button" onClick={() => resetUserProfile()}>
          Clear profile
        </button>
      </div>
    </div>
  )
}
