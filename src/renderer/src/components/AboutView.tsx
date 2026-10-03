import { HOMEPAGE_URL } from '@shared/types'

interface Props {
  version: string
  isMac: boolean
}

export function AboutView({ version, isMac }: Props): React.JSX.Element {
  return (
    <div className="about">
      <div className="about-main">
        {/* Same clipboard glyph as the tray and app icons. */}
        <svg className="about-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3.25" y="3.25" width="9.5" height="11.5" rx="1.6" />
          <rect x="5.5" y="1.75" width="5" height="3" rx="0.9" className="about-icon-clip" />
          <path d="M6.25 8h3.5M6.25 10.75h2.5" />
        </svg>
        <div className="about-name">Copycat</div>
        <div className="about-version">Version {version}</div>
        <p className="about-description">
          Clipboard history for your {isMac ? 'menu bar' : 'system tray'}.
        </p>
        <div className="about-links">
          {/* Links open in the default browser (window.ts routes https to shell.openExternal). */}
          <a className="link" href={HOMEPAGE_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button className="link" onClick={() => window.api.showDataFile()}>
            Show history file
          </button>
        </div>
      </div>

      <div className="about-credit">
        Made with <span className="about-heart">♥</span> by{' '}
        <a href="https://github.com/shricastic" target="_blank" rel="noreferrer">
          Shricastic
        </a>
      </div>
    </div>
  )
}
