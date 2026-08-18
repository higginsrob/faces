import {
  closeSourceTab,
  closeSourceViewer,
  confirmSourceEmbed,
  failSourceEmbed,
  selectSourceTab,
  sourceFrameBlocked,
  useSourceViewer,
  type SourceTab,
} from '../web/viewer'
import { defaultHudBounds, HudWindow } from './HudWindow'

function SourceFrame({ tab, active }: { tab: SourceTab; active: boolean }) {
  if (tab.embed === 'blocked') {
    return (
      <div className={`source-win-blocked${active ? '' : ' off'}`}>
        <p>This page won't display in the app.</p>
        <a
          className="hud-win-action"
          href={tab.url}
          target="_blank"
          rel="noreferrer"
        >
          Open in a new tab
        </a>
      </div>
    )
  }

  return (
    <iframe
      className={`source-win-frame${active ? '' : ' off'}`}
      title={tab.title}
      src={tab.url}
      referrerPolicy="no-referrer-when-downgrade"
      onError={() => failSourceEmbed(tab.id)}
      onLoad={(e) => {
        const iframe = e.currentTarget
        const src = iframe.getAttribute('src') || iframe.src
        if (!src || src === 'about:blank') return
        if (sourceFrameBlocked(iframe)) failSourceEmbed(tab.id)
        else confirmSourceEmbed(tab.id)
      }}
    />
  )
}

export function SourceWindow() {
  const { tabs, activeId } = useSourceViewer()
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  return (
    <HudWindow
      open={Boolean(active)}
      label="Source browser"
      overlayClassName="source-win-overlay"
      defaultBounds={() => defaultHudBounds({ side: 'right' })}
      header={
        <div className="source-win-tabs" role="tablist" aria-label="Open articles">
          {tabs.map((tab) => {
            const selected = tab.id === active?.id
            return (
              <div
                key={tab.id}
                className={`source-win-tab${selected ? ' on' : ''}`}
                role="presentation"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={tab.title}
                  onClick={() => selectSourceTab(tab.id)}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  className="source-win-tab-close"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => closeSourceTab(tab.id)}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      }
      trailing={
        active ? (
          <a
            className="hud-win-action"
            href={active.url}
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
        ) : null
      }
      onClose={() => closeSourceViewer()}
    >
      {tabs.map((tab) => (
        <SourceFrame
          key={tab.id}
          tab={tab}
          active={tab.id === active?.id}
        />
      ))}
    </HudWindow>
  )
}
