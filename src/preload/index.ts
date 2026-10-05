import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type CopycatApi } from '@shared/types'

// Runs sandboxed: only `electron` may be required here, everything else is bundled.
// Expose narrow, named functions; never the raw ipcRenderer.

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: CopycatApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  pasteItem: (id) => ipcRenderer.invoke(IPC.pasteItem, id),
  deleteItem: (id) => ipcRenderer.invoke(IPC.deleteItem, id),
  togglePin: (id) => ipcRenderer.invoke(IPC.togglePin, id),
  showItemMenu: (id) => ipcRenderer.invoke(IPC.showItemMenu, id),
  clearAll: () => ipcRenderer.invoke(IPC.clearAll),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  setShortcutRecording: (active) => ipcRenderer.invoke(IPC.setShortcutRecording, active),
  hidePopup: () => ipcRenderer.invoke(IPC.hidePopup),
  beginDrag: () => ipcRenderer.invoke(IPC.beginDrag),
  endDrag: () => ipcRenderer.invoke(IPC.endDrag),
  showDataFile: () => ipcRenderer.invoke(IPC.showDataFile),
  quit: () => ipcRenderer.invoke(IPC.quit),
  onHistoryChanged: (cb) => subscribe(IPC.historyChanged, cb),
  onSettingsChanged: (cb) => subscribe(IPC.settingsChanged, cb),
  onPopupShown: (cb) => subscribe(IPC.popupShown, cb)
}

contextBridge.exposeInMainWorld('api', api)
