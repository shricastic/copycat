import { useState } from 'react'
import { MAX_HISTORY_LIMIT, type RuntimeStatus, type Settings } from '@shared/types'
import { Toggle } from './Toggle'
import { ShortcutRecorder } from './ShortcutRecorder'

interface Props {
  settings: Settings
  runtime: RuntimeStatus
  isMac: boolean
  /** Applies a change; resolves to an error message if main rejected it. */
  update(patch: Partial<Settings>): Promise<string | undefined>
}

export function SettingsView({ settings, runtime, isMac, update }: Props): React.JSX.Element {
  // Draft value for the number field; committed on blur / Enter.
  const [maxDraft, setMaxDraft] = useState(String(settings.maxHistory))
  const [error, setError] = useState('')

  const apply = async (patch: Partial<Settings>): Promise<void> => {
    setError((await update(patch)) ?? '')
  }

  const commitMax = (): void => {
    const n = Number(maxDraft)
    if (!Number.isInteger(n) || n < 1 || n > MAX_HISTORY_LIMIT) {
      setError(`Keep between 1 and ${MAX_HISTORY_LIMIT} items.`)
      setMaxDraft(String(settings.maxHistory))
      return
    }
    if (n !== settings.maxHistory) void apply({ maxHistory: n })
  }

  return (
    <div className="settings">
      <section className="setting">
        <div className="setting-row">
          <label htmlFor="max-history">History size</label>
          <div className="number-field">
            <input
              id="max-history"
              type="number"
              min={1}
              max={MAX_HISTORY_LIMIT}
              value={maxDraft}
              onChange={(e) => setMaxDraft(e.target.value)}
              onBlur={commitMax}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            <span>items</span>
          </div>
        </div>
        <div className="setting-hint">Oldest items are removed first. Pinned items are kept.</div>
      </section>

      <section className="setting">
        <div className="setting-row">
          <span>Open with</span>
          <ShortcutRecorder
            value={settings.shortcut}
            isMac={isMac}
            onChange={(shortcut) => update({ shortcut })}
          />
        </div>
        {settings.shortcut && !runtime.shortcutRegistered && (
          <div className="setting-hint error">
            Not active: another app is using this shortcut. Choose a different one.
          </div>
        )}
      </section>

      <section className="setting">
        <div className="setting-row">
          <span>Launch at login</span>
          <Toggle
            label="Launch at login"
            checked={settings.launchAtLogin}
            disabled={!runtime.loginItemAvailable}
            onChange={(launchAtLogin) => apply({ launchAtLogin })}
          />
        </div>
        {!runtime.loginItemAvailable && (
          <div className="setting-hint">Available in the installed app.</div>
        )}
      </section>

      <section className="setting">
        <div className="setting-row">
          <span>Pause recording</span>
          <Toggle
            label="Pause recording"
            checked={settings.paused}
            onChange={(paused) => apply({ paused })}
          />
        </div>
      </section>

      <section className="setting">
        <div className="setting-row">
          <span>Clear history on quit</span>
          <Toggle
            label="Clear history on quit"
            checked={settings.clearOnQuit}
            onChange={(clearOnQuit) => apply({ clearOnQuit })}
          />
        </div>
        <div className="setting-hint">Pinned items are kept.</div>
      </section>

      {error && (
        <div className="setting-hint error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
