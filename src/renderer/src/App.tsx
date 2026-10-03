import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Appearance, ClipItem, RuntimeStatus, Settings } from '@shared/types'
import { HistoryItem } from './components/HistoryItem'
import { SettingsView } from './components/SettingsView'

const api = window.api

/** Glass vs opaque theme, and the system accent colour (caret, focus rings, switches). */
function applyAppearance({ glass, accentColor }: Appearance): void {
  const root = document.documentElement
  root.dataset.glass = String(glass)
  root.style.setProperty('--accent', accentColor)
}

type View = 'list' | 'settings'

function App(): React.JSX.Element {
  const [history, setHistory] = useState<ClipItem[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null)
  const [isMac, setIsMac] = useState(true)
  const [view, setView] = useState<View>('list')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [confirmClear, setConfirmClear] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // ---------- data from main ----------

  useEffect(() => {
    api.getState().then((s) => {
      setHistory(s.history)
      setSettings(s.settings)
      setRuntime(s.runtime)
      setIsMac(s.platform === 'darwin')
      applyAppearance(s.appearance)
    })
    const offHistory = api.onHistoryChanged(setHistory)
    const offSettings = api.onSettingsChanged(setSettings)
    // Every time the popup opens: history view, fresh search, top item selected.
    const offShown = api.onPopupShown((appearance) => {
      applyAppearance(appearance)
      setView('list')
      setQuery('')
      setSelected(0)
      setNow(Date.now())
      setConfirmClear(false)
      listRef.current?.scrollTo({ top: 0 })
      searchRef.current?.focus()
    })
    return () => {
      offHistory()
      offSettings()
      offShown()
    }
  }, [])

  // Ages are shown down to the second, so tick every second while the popup is visible.
  useEffect(() => {
    const t = setInterval(() => !document.hidden && setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ---------- derived ----------

  // Pinned items first (each group keeps newest-first order), then filtered by the query.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q ? history.filter((i) => i.text.toLowerCase().includes(q)) : history
    return [...matches.filter((i) => i.pinned), ...matches.filter((i) => !i.pinned)]
  }, [history, query])

  const pinnedCount = useMemo(() => visible.filter((i) => i.pinned).length, [visible])
  const sel = Math.min(selected, Math.max(0, visible.length - 1))

  // Keep the selected row in view when navigating with the keyboard.
  useEffect(() => {
    const id = visible[sel]?.id
    if (id) document.getElementById(`item-${id}`)?.scrollIntoView({ block: 'nearest' })
  }, [sel, visible])

  // ---------- actions ----------

  const paste = useCallback((id: string) => api.pasteItem(id), [])
  const showMenu = useCallback((id: string) => api.showItemMenu(id), [])

  const openSettings = useCallback(() => {
    setConfirmClear(false)
    setView('settings')
  }, [])

  const closeSettings = useCallback(() => {
    setView('list')
    // The search field remounts with the list; focus it once it exists.
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [])

  const updateSettings = useCallback(
    async (patch: Partial<Settings>): Promise<string | undefined> => {
      const result = await api.updateSettings(patch)
      setSettings(result.settings)
      setRuntime(result.runtime)
      return result.ok ? undefined : result.error
    },
    []
  )

  // Window-level so navigation works wherever focus is (rows aren't focusable).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      const mod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+, opens settings (the macOS convention for preferences).
      if (mod && e.key === ',') {
        e.preventDefault()
        return view === 'list' ? openSettings() : closeSettings()
      }

      if (view === 'settings') {
        // Esc steps back to the list first; a second Esc closes the popup.
        if (e.key === 'Escape') {
          e.preventDefault()
          closeSettings()
        }
        return
      }

      // Let Enter activate a focused footer button instead of pasting.
      if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) return
      const item = visible[sel]
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelected(Math.min(sel + 1, visible.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelected(Math.max(sel - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (item) paste(item.id)
          break
        case 'Escape':
          e.preventDefault()
          api.hidePopup()
          break
        case 'Backspace':
          // Cmd+Backspace (Ctrl on Windows) deletes the selected item. While there is a search
          // query it keeps its usual text-editing meaning.
          if (!mod || query || !item) return
          e.preventDefault()
          api.deleteItem(item.id)
          break
        case 'p':
        case 'P':
          // Cmd/Ctrl+P pins or unpins the selected item.
          if (!mod || !item) return
          e.preventDefault()
          api.togglePin(item.id)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, sel, visible, paste, query, openSettings, closeSettings])

  const clearAll = (): void => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    setConfirmClear(false)
    api.clearAll()
  }

  const paused = settings?.paused ?? false

  return (
    <div className="app">
      {view === 'list' ? (
        <header className="header">
          <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="6.75" cy="6.75" r="4.75" />
            <path d="M10.25 10.25 14 14" />
          </svg>
          <input
            ref={searchRef}
            className="search"
            type="search"
            placeholder="Search clipboard history"
            aria-label="Search clipboard history"
            aria-controls="history-list"
            aria-activedescendant={visible[sel] ? `item-${visible[sel].id}` : undefined}
            autoFocus
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
          />
        </header>
      ) : (
        <header className="header">
          <button className="back" onClick={closeSettings} aria-label="Back to history">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3 5 8l5 5" />
            </svg>
          </button>
          <h1 className="header-title">Settings</h1>
        </header>
      )}

      {paused && view === 'list' && (
        <div className="banner" role="status">
          Paused. New copies aren&rsquo;t being saved.
        </div>
      )}

      {view === 'settings' && settings && runtime ? (
        <SettingsView settings={settings} runtime={runtime} isMac={isMac} update={updateSettings} />
      ) : visible.length === 0 ? (
        <div className="empty">
          {history.length === 0
            ? 'Text you copy will appear here.'
            : `Nothing matches “${query.trim()}”.`}
        </div>
      ) : (
        <ul id="history-list" ref={listRef} className="list" role="listbox">
          {visible.map((item, index) => (
            <HistoryItem
              key={item.id}
              item={item}
              index={index}
              selected={index === sel}
              lastPinned={index === pinnedCount - 1 && pinnedCount < visible.length}
              now={now}
              onSelect={setSelected}
              onPaste={paste}
              onMenu={showMenu}
            />
          ))}
        </ul>
      )}

      <footer className="footer">
        <div className="footer-group">
          <button
            className={`link${confirmClear ? ' danger' : ''}`}
            onClick={clearAll}
            disabled={history.every((i) => i.pinned)}
          >
            {confirmClear ? 'Click again to clear' : 'Clear all'}
          </button>
          <button className="link" onClick={() => updateSettings({ paused: !paused })}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
        <div className="footer-group">
          <button
            className={`link icon${view === 'settings' ? ' active' : ''}`}
            onClick={view === 'list' ? openSettings : closeSettings}
            aria-label="Settings"
            aria-pressed={view === 'settings'}
            title={`Settings (${isMac ? '⌘' : 'Ctrl+'},)`}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" />
              <circle cx="11" cy="4.5" r="1.5" />
              <circle cx="5" cy="11.5" r="1.5" />
            </svg>
          </button>
          <button className="link" onClick={() => api.quit()}>
            Quit
          </button>
        </div>
      </footer>
    </div>
  )
}

export default App
