import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Appearance, ClipItem, Settings } from '@shared/types'
import { HistoryItem } from './components/HistoryItem'

const api = window.api

/** Glass vs opaque theme, and the system accent colour (caret, focus rings). */
function applyAppearance({ glass, accentColor }: Appearance): void {
  const root = document.documentElement
  root.dataset.glass = String(glass)
  root.style.setProperty('--accent', accentColor)
}

function App(): React.JSX.Element {
  const [history, setHistory] = useState<ClipItem[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
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
      applyAppearance(s.appearance)
    })
    const offHistory = api.onHistoryChanged(setHistory)
    const offSettings = api.onSettingsChanged(setSettings)
    // Every time the popup opens: fresh search, top item selected, timestamps updated.
    const offShown = api.onPopupShown((appearance) => {
      applyAppearance(appearance)
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? history.filter((i) => i.text.toLowerCase().includes(q)) : history
  }, [history, query])

  const sel = Math.min(selected, Math.max(0, visible.length - 1))

  // Keep the selected row in view when navigating with the keyboard.
  useEffect(() => {
    const id = visible[sel]?.id
    if (id) document.getElementById(`item-${id}`)?.scrollIntoView({ block: 'nearest' })
  }, [sel, visible])

  // ---------- actions ----------

  const paste = useCallback((id: string) => api.pasteItem(id), [])
  const showMenu = useCallback((id: string) => api.showItemMenu(id), [])

  // Window-level so navigation works wherever focus is (rows aren't focusable).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      // Let Enter activate a focused footer button instead of pasting.
      if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelected(Math.min(sel + 1, visible.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelected(Math.max(sel - 1, 0))
          break
        case 'Enter': {
          e.preventDefault()
          const item = visible[sel]
          if (item) paste(item.id)
          break
        }
        case 'Escape':
          e.preventDefault()
          api.hidePopup()
          break
        case 'Backspace': {
          // Cmd+Backspace (Ctrl on Windows) deletes the selected item. While there is a search
          // query it keeps its usual text-editing meaning.
          const item = visible[sel]
          if (!(e.metaKey || e.ctrlKey) || query || !item) return
          e.preventDefault()
          api.deleteItem(item.id)
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sel, visible, paste, query])

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

      {paused && (
        <div className="banner" role="status">
          Paused. New copies aren&rsquo;t being saved.
        </div>
      )}

      {visible.length === 0 ? (
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
          <button className="link" onClick={() => api.updateSettings({ paused: !paused })}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
        <button className="link" onClick={() => api.quit()}>
          Quit
        </button>
      </footer>
    </div>
  )
}

export default App
