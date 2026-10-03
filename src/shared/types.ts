// Types and constants shared by main, preload and renderer.
// Keep this file free of runtime dependencies on Node or DOM APIs.

export interface ClipItem {
  id: string
  text: string
  /** Epoch ms of the most recent copy of this text. */
  createdAt: number
  pinned: boolean
}

export interface Settings {
  maxHistory: number
  shortcut: string
  launchAtLogin: boolean
  paused: boolean
  clearOnQuit: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  maxHistory: 100,
  shortcut: 'CommandOrControl+Shift+V',
  launchAtLogin: false,
  paused: false,
  clearOnQuit: false
}

export const MAX_HISTORY_LIMIT = 1000

/** IPC channel names. Invoke channels are request/response; events are main -> renderer pushes. */
export const IPC = {
  // renderer -> main (invoke)
  getState: 'state:get',
  pasteItem: 'item:paste',
  deleteItem: 'item:delete',
  togglePin: 'item:togglePin',
  showItemMenu: 'item:menu',
  clearAll: 'history:clear',
  updateSettings: 'settings:update',
  hidePopup: 'popup:hide',
  quit: 'app:quit',
  // main -> renderer (events)
  historyChanged: 'history:changed',
  settingsChanged: 'settings:changed',
  popupShown: 'popup:shown'
} as const

export interface Appearance {
  /** The OS draws a translucent material behind the window (macOS vibrancy, Windows acrylic). */
  glass: boolean
  /** System accent colour, #rrggbb. */
  accentColor: string
}

export interface AppState {
  history: ClipItem[]
  settings: Settings
  /** process.platform of the main process ('darwin', 'win32', ...). */
  platform: string
  appearance: Appearance
}

export interface UpdateSettingsResult {
  ok: boolean
  settings: Settings
  error?: string
}

/** The API exposed to the renderer as `window.api` by the preload script. */
export interface CopycatApi {
  getState(): Promise<AppState>
  pasteItem(id: string): Promise<void>
  deleteItem(id: string): Promise<void>
  togglePin(id: string): Promise<void>
  /** Native context menu for an item (Copy, Delete). */
  showItemMenu(id: string): Promise<void>
  clearAll(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<UpdateSettingsResult>
  hidePopup(): Promise<void>
  quit(): Promise<void>
  onHistoryChanged(cb: (history: ClipItem[]) => void): () => void
  onSettingsChanged(cb: (settings: Settings) => void): () => void
  onPopupShown(cb: (appearance: Appearance) => void): () => void
}
