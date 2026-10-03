import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { togglePopupFromTray } from './window'

let tray: Tray | null = null

export interface TrayMenuHandlers {
  onOpen(): void
  onQuit(): void
}

function trayIconPath(): string {
  // `resources/` is unpacked from the asar in production (see electron-builder.yml asarUnpack).
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(__dirname, '../../resources')
  // macOS picks up iconTemplate@2x.png automatically for Retina displays.
  return join(dir, process.platform === 'darwin' ? 'iconTemplate.png' : 'tray.ico')
}

export function createTray(handlers: TrayMenuHandlers): Tray {
  const image = nativeImage.createFromPath(trayIconPath())
  if (process.platform === 'darwin') image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('Copycat')
  // Deliberately no tray.setContextMenu(): on macOS that would hijack left-click.
  // The context menu is shown manually on right-click instead.

  tray.on('click', () => togglePopupFromTray(tray!.getBounds()))
  tray.on('right-click', () => {
    tray!.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Copycat', click: handlers.onOpen },
        { type: 'separator' },
        { label: 'Quit Copycat', click: handlers.onQuit }
      ])
    )
  })

  return tray
}

export function getTray(): Tray | null {
  return tray
}
