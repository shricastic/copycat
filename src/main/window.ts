import {
  BrowserWindow,
  screen,
  shell,
  systemPreferences,
  type BrowserWindowConstructorOptions,
  type Rectangle,
  type Point
} from 'electron'
import { join } from 'path'
import { release } from 'os'
import { is } from '@electron-toolkit/utils'
import { IPC, type Appearance, type PopupShownInfo, type PopupView } from '@shared/types'
import { logEvent } from './log'

const WIDTH = 300
const HEIGHT = 400
/** Gap between the tray icon / cursor and the popup. */
const MARGIN = 6
/**
 * Clicking the tray icon while the popup is open first blurs the popup (which hides it)
 * and then delivers the tray click. A click that lands within this window after a blur-hide
 * is treated as "close" rather than "reopen".
 */
const BLUR_CLICK_GRACE_MS = 300

/** Zoom levels (Chromium scale: factor = 1.2 ^ level). 0.5 steps are ~10% each. */
const ZOOM_STEP = 0.5
const ZOOM_MIN = -2 // ~69%
const ZOOM_MAX = 3 // ~173%

let win: BrowserWindow | null = null
let lastBlurHideAt = 0
/** The renderer is recording a shortcut and needs every key combination. */
let capturingKeys = false
let quitting = false

/** How the popup was last placed, for the off-screen guard and its diagnostics. */
interface LastShow {
  source: 'tray' | 'cursor'
  computed: Point
  tray?: Rectangle
}
let lastShow: LastShow | null = null

/** An active user drag: where the cursor grabbed the window, and the follow timer. */
let drag: { grab: Point; timer: ReturnType<typeof setInterval> | null } | null = null

/**
 * Whether the OS draws a translucent material behind the popup. macOS: vibrancy (all
 * supported versions). Windows: backgroundMaterial needs Windows 11 22H2 (build 22621).
 * Elsewhere the renderer falls back to an opaque theme.
 */
const glass =
  process.platform === 'darwin' ||
  (process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22621)

function materialOptions(): BrowserWindowConstructorOptions {
  if (!glass) return {}
  if (process.platform === 'darwin') {
    return {
      // The material system menu bar popovers use; follows light/dark automatically.
      vibrancy: 'popover',
      // Stay frosted even while another app is frontmost (default dims to grey when inactive).
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    }
  }
  // Untested here (built on macOS): verify on Windows 11 that acrylic renders behind a
  // frameless window. On older Windows `glass` is false and none of this applies.
  return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
}

/** System accent colour as #rrggbb (macOS and Windows), for the selected row. */
function accentColor(): string {
  try {
    const c = systemPreferences.getAccentColor() // 'rrggbbaa'
    if (/^[0-9a-f]{6}/i.test(c)) return `#${c.slice(0, 6)}`
  } catch {
    // not available on this platform
  }
  return '#0a84ff'
}

export function getAppearance(): Appearance {
  return { glass, accentColor: accentColor() }
}

export function createPopupWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    // Dragged by the renderer's grab bar / footer through beginDrag/endDrag (not CSS drag
    // regions: those can't show a grab cursor on macOS), so the OS never moves it itself.
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    ...materialOptions(),
    // Not using type: 'panel' on macOS: Electron applies a panel-only style mask to a regular
    // NSWindow, which AppKit ignores and logs about. setVisibleOnAllWorkspaces below is what
    // lets the popup show over full-screen apps.
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })

  // Cmd+W (default menu) would destroy the popup and it is never recreated: hide instead.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hidePopup()
  })

  win.on('blur', () => {
    // Keep the popup open while DevTools has focus during development.
    if (win?.webContents.isDevToolsOpened()) return
    hidePopup(true)
  })

  // Never let the renderer open windows or navigate away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // Moves while visible: a user drag (beginDrag..endDrag) is left alone until it ends, then the
  // popup is kept fully on that screen. Any other move comes from the system and must never
  // leave it off screen. Same after display changes (monitor plugged/unplugged, resolution).
  win.on('move', () => {
    if (!drag) ensureOnScreen('moved')
  })
  win.on('hide', () => endDrag())
  screen.on('display-added', () => ensureOnScreen('display-added'))
  screen.on('display-removed', () => ensureOnScreen('display-removed'))
  screen.on('display-metrics-changed', () => ensureOnScreen('display-metrics-changed'))

  // Zoom: Cmd/Ctrl + / - / 0. Handled here rather than via Electron's default menu, whose
  // zoom-out accelerator didn't fire in this menu-less (LSUIElement) app. preventDefault also
  // stops the menu from applying the same zoom a second time. Chromium persists the level.
  win.webContents.on('before-input-event', (e, input) => {
    if (capturingKeys) return
    if (input.type !== 'keyDown' || !(input.meta || input.control) || input.alt) return
    const wc = win!.webContents
    let level: number
    if (input.key === '=' || input.key === '+' || input.code === 'NumpadAdd') {
      level = wc.getZoomLevel() + ZOOM_STEP
    } else if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract') {
      level = wc.getZoomLevel() - ZOOM_STEP
    } else if (input.key === '0' || input.code === 'Numpad0') {
      level = 0
    } else {
      return
    }
    e.preventDefault()
    wc.setZoomLevel(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level)))
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Let the window close for real (app quit). */
export function allowPopupClose(): void {
  quitting = true
}

/**
 * While recording a shortcut, deliver every key combination to the page: skip zoom handling
 * and menu accelerators (Cmd+Q, Cmd+W, ...).
 */
export function setKeyboardCapture(active: boolean): void {
  capturingKeys = active
  win?.webContents.setIgnoreMenuShortcuts(active)
}

export function getPopupWindow(): BrowserWindow | null {
  return win
}

export function isPopupVisible(): boolean {
  return !!win && win.isVisible()
}

export function hidePopup(fromBlur = false): void {
  if (!win || !win.isVisible()) return
  if (fromBlur) lastBlurHideAt = Date.now()
  win.hide()
  // On Windows, hiding a focused window does not return focus to the previous app on its own.
  if (process.platform === 'win32') win.blur()
}

/** Tray-click handler: open under/above the tray icon, or close if already open. */
export function togglePopupFromTray(trayBounds: Rectangle): void {
  if (!win) return
  if (win.isVisible()) {
    hidePopup()
    return
  }
  if (Date.now() - lastBlurHideAt < BLUR_CLICK_GRACE_MS) {
    // The click that caused the blur was this tray click: the user wanted to close it.
    lastBlurHideAt = 0
    return
  }
  showAt(positionForTray(trayBounds), 'list', { source: 'tray', tray: trayBounds })
}

/**
 * Open under/above the tray icon on the given page (tray menu "Open" / "About"). If it is
 * already open, just switch to that page.
 */
export function showPopupFromTray(trayBounds: Rectangle, view: PopupView = 'list'): void {
  if (!win) return
  if (win.isVisible()) {
    if (view !== 'list') notifyShown(view)
    return
  }
  showAt(positionForTray(trayBounds), view, { source: 'tray', tray: trayBounds })
}

/** Global-shortcut handler: open centered near the cursor, or close if already open. */
export function togglePopupAtCursor(): void {
  if (!win) return
  if (win.isVisible()) {
    hidePopup()
    return
  }
  showAt(positionNearCursor(screen.getCursorScreenPoint()), 'list', { source: 'cursor' })
}

function showAt(pos: Point, view: PopupView, context: Omit<LastShow, 'computed'>): void {
  if (!win) return
  // Every open starts from the tray (or cursor) position; a previous drag isn't remembered.
  endDrag()
  lastShow = { ...context, computed: pos }
  // setBounds rather than setPosition: also restores the size if anything changed it.
  win.setBounds({ x: pos.x, y: pos.y, width: WIDTH, height: HEIGHT })
  win.show()
  win.focus()
  notifyShown(view)
  // Catch the system placing the window somewhere else as it is shown.
  setTimeout(() => ensureOnScreen('after-show'), 150)
}

const fitsIn = (b: Rectangle, area: Rectangle): boolean =>
  b.x >= area.x &&
  b.y >= area.y &&
  b.x + b.width <= area.x + area.width &&
  b.y + b.height <= area.y + area.height

/**
 * If the visible popup isn't fully inside some display's work area (or has the wrong size),
 * put it back: where we last placed it if that still fits, otherwise clamped onto the display
 * it overlaps most. Every correction is logged, since it means something moved the window
 * behind our back.
 */
function ensureOnScreen(reason: string): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const actual = win.getBounds()
  const displays = screen.getAllDisplays()
  const sizeOk = actual.width === WIDTH && actual.height === HEIGHT
  if (sizeOk && displays.some((d) => fitsIn(actual, d.workArea))) return

  const intended = lastShow && { ...lastShow.computed, width: WIDTH, height: HEIGHT }
  const target =
    intended && displays.some((d) => fitsIn(intended, d.workArea))
      ? lastShow!.computed
      : clampToArea(actual.x, actual.y, screen.getDisplayMatching(actual).workArea)

  logEvent('popup-off-screen', {
    reason,
    actual,
    corrected: target,
    lastShow,
    displays: displays.map((d) => ({
      bounds: d.bounds,
      workArea: d.workArea,
      scale: d.scaleFactor
    }))
  })
  win.setBounds({ x: target.x, y: target.y, width: WIDTH, height: HEIGHT })
}

/**
 * A user drag has finished. Keep the popup where it was dropped, but fully on the screen it
 * mostly covers, and treat that as its placed position from now on (so later system moves
 * are corrected back to it, not to the tray).
 */
function settleAfterDrag(): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const actual = win.getBounds()
  const target = clampToArea(actual.x, actual.y, screen.getDisplayMatching(actual).workArea)
  if (target.x !== actual.x || target.y !== actual.y) {
    win.setBounds({ x: target.x, y: target.y, width: WIDTH, height: HEIGHT })
  }
  if (lastShow) lastShow = { ...lastShow, computed: target }
}

/**
 * Start dragging the popup (mouse down on the grab bar or footer). The window follows the
 * cursor, keeping the point that was grabbed under it, until endDrag. `at` replaces the live
 * cursor and disables the follow timer; it exists for scripted checks (dragStep moves it).
 */
export function beginDrag(at?: Point): void {
  if (!win || !win.isVisible() || drag) return
  const cursor = at ?? screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  drag = { grab: { x: cursor.x - x, y: cursor.y - y }, timer: null }
  if (!at) drag.timer = setInterval(() => dragStep(screen.getCursorScreenPoint()), 16)
}

export function dragStep(cursor: Point): void {
  if (!win || !drag) return
  const x = Math.round(cursor.x - drag.grab.x)
  const y = Math.round(cursor.y - drag.grab.y)
  const [cx, cy] = win.getPosition()
  if (x !== cx || y !== cy) win.setPosition(x, y, false)
}

/** Mouse released (or the popup hid): stop following and settle where it was dropped. */
export function endDrag(): void {
  if (!drag) return
  if (drag.timer) clearInterval(drag.timer)
  drag = null
  settleAfterDrag()
}

/** Re-sent on every open so a changed system accent colour is picked up. */
function notifyShown(view: PopupView): void {
  const info: PopupShownInfo = { appearance: getAppearance(), view }
  win?.webContents.send(IPC.popupShown, info)
}

/** Clamp a WIDTH x HEIGHT rect at (x, y) so it is fully inside `area`. */
function clampToArea(x: number, y: number, area: Rectangle): Point {
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - WIDTH)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - HEIGHT))
  }
}

/**
 * Place the popup next to the tray icon on whichever edge of the screen the tray lives:
 * below it for a top menu bar (macOS), above it for a bottom taskbar (Windows default),
 * and beside it for left/right taskbars. Always clamped to the work area of the display
 * that contains the icon, so it stays on screen on multi-monitor setups.
 */
function positionForTray(tray: Rectangle): Point {
  // Some environments report empty tray bounds (e.g. icon in the Windows overflow flyout,
  // or Linux). Fall back to the cursor, which is where the user just clicked.
  if (tray.width === 0 || tray.height === 0) {
    return positionNearCursor(screen.getCursorScreenPoint())
  }

  const center = { x: tray.x + tray.width / 2, y: tray.y + tray.height / 2 }
  const display = screen.getDisplayNearestPoint(center)
  const wa = display.workArea

  let x = center.x - WIDTH / 2
  let y: number

  if (tray.y + tray.height <= wa.y + 1) {
    // Menu bar / taskbar at the top: open flush below it, like native menu bar menus.
    y = wa.y
  } else if (tray.y >= wa.y + wa.height - 1) {
    // Taskbar at the bottom: open above it.
    y = wa.y + wa.height - HEIGHT - MARGIN
  } else if (tray.x + tray.width <= wa.x + 1) {
    // Taskbar on the left.
    x = wa.x + MARGIN
    y = center.y - HEIGHT / 2
  } else if (tray.x >= wa.x + wa.width - 1) {
    // Taskbar on the right.
    x = wa.x + wa.width - WIDTH - MARGIN
    y = center.y - HEIGHT / 2
  } else {
    // Tray rect is inside the work area (auto-hide taskbar, unusual setups):
    // pick the side with more room.
    const below = wa.y + wa.height - (tray.y + tray.height)
    const above = tray.y - wa.y
    y = below >= above ? tray.y + tray.height + MARGIN : tray.y - HEIGHT - MARGIN
  }

  return clampToArea(x, y, wa)
}

function positionNearCursor(cursor: Point): Point {
  const wa = screen.getDisplayNearestPoint(cursor).workArea
  return clampToArea(cursor.x - WIDTH / 2, cursor.y - HEIGHT / 3, wa)
}
