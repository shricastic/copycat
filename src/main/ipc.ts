import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, DEFAULT_SETTINGS, type AppState } from '@shared/types'
import { getPopupWindow, hidePopup } from './window'

export interface IpcDeps {
  quit(): void
}

/** Only accept IPC from our own popup window. */
function assertTrustedSender(e: IpcMainInvokeEvent): void {
  const win = getPopupWindow()
  if (!win || e.sender !== win.webContents) {
    throw new Error('IPC from untrusted sender')
  }
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e, ...args) => {
    assertTrustedSender(e)
    return fn(...(args as A))
  })
}

export function registerIpc(deps: IpcDeps): void {
  handle(IPC.getState, (): AppState => ({
    history: [],
    settings: DEFAULT_SETTINGS,
    platform: process.platform
  }))
  handle(IPC.hidePopup, () => hidePopup())
  handle(IPC.quit, () => deps.quit())
}
