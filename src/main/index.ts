import * as electron from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '@shared/types'
import { createTray, getTray, trayIconState, updateTrayStatus } from './tray'
import * as windowApi from './window'
import { createPopupWindow, getPopupWindow, togglePopupAtCursor } from './window'
import { registerIpc } from './ipc'
import { Store, MAX_TEXT_LENGTH } from './store'
import { ClipboardWatcher } from './clipboardWatcher'
import { SettingsController } from './settings'
import { getLogPath } from './log'

// Scripted checks (scripts/e2e.mjs) run with their own profile so they neither touch real
// history nor collide with a running instance's single-instance lock. Dev only.
const e2e = is.dev && !!process.env['COPYCAT_E2E']
if (e2e) app.setPath('userData', join(app.getPath('temp'), `copycat-e2e-${process.pid}`))

// Only one instance may run: a second launch just opens the existing popup.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => togglePopupAtCursor())

  // Menu bar app: no Dock icon. LSUIElement in electron-builder.yml covers the packaged app;
  // this covers `npm run dev` and avoids a Dock bounce on launch.
  if (process.platform === 'darwin') app.dock?.hide()

  const store = new Store(join(app.getPath('userData'), 'copycat.json'))
  store.load()

  const watcher = new ClipboardWatcher({
    intervalMs: 400,
    maxTextLength: MAX_TEXT_LENGTH,
    isPaused: () => store.getSettings().paused,
    onText: (text) => store.addText(text)
  })

  // Push changes to the renderer; it never polls.
  const send = (channel: string, payload: unknown): void => {
    const win = getPopupWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  store.on('history', (history) => send(IPC.historyChanged, history))
  store.on('settings', (settings) => {
    send(IPC.settingsChanged, settings)
    updateTrayStatus(settings.paused)
  })

  const settings = new SettingsController(store, () => togglePopupAtCursor())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.copycat.app')

    // F12 toggles DevTools in development; Cmd/Ctrl+R reload is disabled in production.
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    registerIpc({ store, watcher, settings, quit: () => app.quit() })
    const popup = createPopupWindow()
    // If the popup closes mid-recording, put the global shortcut back.
    popup.on('hide', () => {
      settings.setRecording(false)
      windowApi.setKeyboardCapture(false)
    })
    createTray({
      isPaused: () => store.getSettings().paused,
      onTogglePause: () => settings.update({ paused: !store.getSettings().paused }),
      onClickAbout: () => {
        const tray = getTray()
        if (tray) windowApi.showPopupFromTray(tray.getBounds(), 'about')
      },
      onQuit: () => app.quit()
    })
    settings.init()
    watcher.start()

    // Test hook for scripted checks over the inspector.
    if (e2e) {
      ;(globalThis as Record<string, unknown>).__copycat = {
        electron,
        windowApi,
        getTray,
        trayIconState,
        getLogPath,
        store,
        watcher,
        settings
      }
    }
  })

  app.on('before-quit', () => {
    windowApi.allowPopupClose()
    watcher.stop()
    settings.dispose()
    if (store.getSettings().clearOnQuit) store.clearUnpinned()
    store.flush()
  })

  // The popup is hidden, never closed, but keep the app alive regardless: it lives in the tray.
  app.on('window-all-closed', () => {})
}
