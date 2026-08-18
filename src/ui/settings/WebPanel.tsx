import { patchWebConfig, useWebConfig } from '../../web/store'
import { setSettingsTab } from '../../chat/session'

export function WebPanel() {
  const cfg = useWebConfig()

  return (
    <div className="settings-stack">
      <p className="hint">
        Faces fetches a daily briefing in the browser, ranks it for the
        selected profile, and gives the top stories to every persona as
        background. They never get a search tool. Headlines are from the past
        two weeks and cached once a day; once a face brings one up, it stays
        off the list unless you steer back to it. Turn on News to show the
        newspaper button next to Settings — open it to mark stories with an
        interest or a skip topic, mention them, and load source pages into this
        chat. Data sources and topics live on each profile in{' '}
        <button
          type="button"
          className="newspaper-settings-link"
          onClick={() => setSettingsTab('profile')}
        >
          Settings → Profiles
        </button>
        . GitHub Pages cannot proxy news sites, so Faces uses Jina Search for
        headlines and Jina Reader for source pages. Paywalled pages may not
        come through.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => patchWebConfig({ enabled: e.target.checked })}
        />
        Enable News
      </label>

      <section>
        <h3>Jina</h3>
        <p className="hint">
          Headlines come from{' '}
          <a href="https://jina.ai/" target="_blank" rel="noreferrer">
            Jina Search
          </a>
          . Source pages are fetched through{' '}
          <a href="https://jina.ai/reader/" target="_blank" rel="noreferrer">
            Jina Reader
          </a>
          . Paste a free API key from{' '}
          <a
            href="https://jina.ai/api-dashboard/key-manager"
            target="_blank"
            rel="noreferrer"
          >
            jina.ai
          </a>
          . It is stored only in this browser.
        </p>
        <div className="form-grid">
          <label className="span-2">
            API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={cfg.jinaApiKey}
              placeholder="Paste your Jina API key"
              onChange={(e) => patchWebConfig({ jinaApiKey: e.target.value })}
            />
          </label>
        </div>
        {cfg.enabled && !cfg.jinaApiKey.trim() ? (
          <p className="hint">
            Add a Jina API key to fetch local and topic headlines and to load
            full articles. National news can still use Wikipedia without a
            key.
          </p>
        ) : null}
      </section>
    </div>
  )
}
