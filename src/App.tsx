import { useEffect } from 'react'
import {
  handleSessionEscape,
  promptPersonaFromWall,
  setError,
  setSettingsTab,
  useSession,
} from './chat/session'
import { usePersonas } from './personas/store'
import { useUserProfile } from './profile/store'
import { RoomScene } from './scene/Room'
import { ChatOverlay } from './ui/ChatOverlay'
import { Newspaper } from './ui/Newspaper'
import { SettingsShell } from './ui/settings/SettingsShell'
import { SourceWindow } from './ui/SourceWindow'
import { TalkBar } from './ui/TalkBar'
import { UsageModal } from './ui/UsageModal'
import { useOllamaConfig } from './ollama/store'
import { ensureWebDigest } from './web/ensure'
import { refreshLocalScores } from './web/rerank'
import { useWebConfig } from './web/store'

export default function App() {
  const session = useSession()
  const { activeId, personas } = usePersonas()
  const ollama = useOllamaConfig()
  const web = useWebConfig()
  const profile = useUserProfile()
  const persona = personas.find((p) => p.id === activeId) ?? personas[0]!

  const needsSetup = !ollama.model

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.isComposing) return
      if (handleSessionEscape()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (!web.enabled) return
    const t = window.setTimeout(() => {
      void ensureWebDigest()
    }, 500)
    return () => window.clearTimeout(t)
  }, [
    web.enabled,
    web.sources.clock,
    web.sources.weather,
    web.sources.nationalNews,
    web.sources.localNews,
    web.topics,
    profile.location,
    profile.interests,
    profile.age,
    profile.politics,
    profile.religion,
  ])

  useEffect(() => {
    if (!web.enabled) return
    refreshLocalScores()
  }, [web.enabled, web.ignoreTopics.join('\0')])

  return (
    <div className="app" data-persona={activeId}>
      <div className="stage">
        <RoomScene
          viewMode={session.viewMode}
          selectedEmoji={persona.defaultFace}
          heroEmoji={session.face}
          highlightedEmoji={session.highlightedFace}
          onSelectEmoji={promptPersonaFromWall}
        />
      </div>
      <div className="bottom-stack">
        {session.error ? (
          <div className="banner bad" role="alert">
            {session.error}
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {needsSetup && !session.settingsOpen ? (
          <div className="banner">
            <span>
              Pick a local Ollama model in{' '}
              <button type="button" onClick={() => setSettingsTab('chat')}>
                Settings
              </button>{' '}
              to start talking.
            </span>
          </div>
        ) : null}
        <ChatOverlay />
        <TalkBar />
      </div>
      <Newspaper />
      <SettingsShell />
      <UsageModal />
      <SourceWindow />
    </div>
  )
}
