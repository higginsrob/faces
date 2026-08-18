import { setSettingsOpen, setSettingsTab, useSession } from '../../chat/session'
import { OllamaPanel } from './OllamaPanel'
import { PersonasPanel } from './PersonasPanel'
import { ProfilePanel } from './ProfilePanel'
import { RerankPanel } from './RerankPanel'
import { VoicePanel } from './VoicePanel'
import { WebPanel } from './WebPanel'

export function SettingsShell() {
  const { settingsOpen, settingsTab } = useSession()
  if (!settingsOpen) return null

  return (
    <div className="settings-overlay" role="dialog" aria-label="Settings">
      <div className="settings-sheet">
        <header className="settings-head">
          <h2>Settings</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(false)}
          >
            Close
          </button>
        </header>
        <div className="settings-tabs">
          <button
            type="button"
            className={settingsTab === 'profile' ? 'active' : ''}
            onClick={() => setSettingsTab('profile')}
          >
            Profile
          </button>
          <button
            type="button"
            className={settingsTab === 'personas' ? 'active' : ''}
            onClick={() => setSettingsTab('personas')}
          >
            Personas
          </button>
          <button
            type="button"
            className={settingsTab === 'chat' ? 'active' : ''}
            onClick={() => setSettingsTab('chat')}
          >
            Chat Model
          </button>
          <button
            type="button"
            className={settingsTab === 'rerank' ? 'active' : ''}
            onClick={() => setSettingsTab('rerank')}
          >
            Rerank Model
          </button>
          <button
            type="button"
            className={settingsTab === 'voice' ? 'active' : ''}
            onClick={() => setSettingsTab('voice')}
          >
            Voice
          </button>
          <button
            type="button"
            className={settingsTab === 'news' ? 'active' : ''}
            onClick={() => setSettingsTab('news')}
          >
            News
          </button>
        </div>
        <div className="settings-body">
          {settingsTab === 'profile' ? <ProfilePanel /> : null}
          {settingsTab === 'personas' ? <PersonasPanel /> : null}
          {settingsTab === 'chat' ? <OllamaPanel /> : null}
          {settingsTab === 'rerank' ? <RerankPanel /> : null}
          {settingsTab === 'voice' ? <VoicePanel /> : null}
          {settingsTab === 'news' ? <WebPanel /> : null}
        </div>
      </div>
    </div>
  )
}
