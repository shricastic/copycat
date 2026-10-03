import { useEffect } from 'react'

function App(): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.api.hidePopup()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <input className="search" type="search" placeholder="Search history" autoFocus />
      </header>
      <main className="list">
        <div className="empty">Nothing copied yet</div>
      </main>
      <footer className="footer">
        <span />
        <button className="link" onClick={() => window.api.quit()}>
          Quit
        </button>
      </footer>
    </div>
  )
}

export default App
