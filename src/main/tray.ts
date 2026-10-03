import { Tray, Menu, nativeImage, app, type NativeImage } from 'electron'
import { join } from 'path'
import { showPopupFromTray, togglePopupFromTray } from './window'

let tray: Tray | null = null

export interface TrayMenuHandlers {
  isPaused(): boolean
  onTogglePause(): void
  onQuit(): void
}

/** Normal and paused tray images, loaded once. */
let icons: { normal: NativeImage; paused: NativeImage } | null = null
/** State the tray currently shows; every settings change calls updateTrayStatus. */
let showingPaused = false

function loadIcon(paused: boolean): NativeImage {
  // `resources/` is unpacked from the asar in production (see electron-builder.yml asarUnpack).
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(__dirname, '../../resources')
  if (process.platform === 'darwin') {
    // macOS picks up the @2x file automatically for Retina displays.
    const image = nativeImage.createFromPath(
      join(dir, paused ? 'iconPausedTemplate.png' : 'iconTemplate.png')
    )
    image.setTemplateImage(true)
    return image
  }
  return nativeImage.createFromPath(join(dir, paused ? 'trayPaused.ico' : 'tray.ico'))
}

export function createTray(handlers: TrayMenuHandlers): Tray {
  icons = { normal: loadIcon(false), paused: loadIcon(true) }
  tray = new Tray(icons.normal)
  tray.setToolTip('Copycat')
  updateTrayStatus(handlers.isPaused())
  // Deliberately no tray.setContextMenu(): on macOS that would hijack left-click.
  // The context menu is built fresh on each right-click so it reflects current state.

  tray.on('click', () => togglePopupFromTray(tray!.getBounds()))
  tray.on('right-click', () => {
    tray!.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Copycat', click: () => showPopupFromTray(tray!.getBounds()) },
        {
          label: 'Pause recording',
          type: 'checkbox',
          checked: handlers.isPaused(),
          click: handlers.onTogglePause
        },
        { type: 'separator' },
        { label: 'Quit Copycat', click: handlers.onQuit }
      ])
    )
  })

  return tray
}

/** Reflect the paused state: pause-symbol icon (grey tile on Windows) and tooltip. */
export function updateTrayStatus(paused: boolean): void {
  if (!tray || !icons || paused === showingPaused) return
  showingPaused = paused
  tray.setImage(paused ? icons.paused : icons.normal)
  tray.setToolTip(paused ? 'Copycat (recording paused)' : 'Copycat')
}

/** For checks: whether the paused image is showing, and whether both images loaded. */
export function trayIconState(): { paused: boolean; loaded: boolean } {
  return {
    paused: showingPaused,
    loaded: !!icons && !icons.normal.isEmpty() && !icons.paused.isEmpty()
  }
}

export function getTray(): Tray | null {
  return tray
}
