import { clipboard } from 'electron'
import { createHash } from 'crypto'

/**
 * Polls the system clipboard (Electron has no change event) and reports new text copies.
 *
 * Each tick reads the format list and the plain text, and compares them with the previous
 * tick; only when that signature changes does it do the more expensive work (privacy marker
 * checks, hashing, reporting). The content hash is what identifies "the same content" across
 * ticks and own writes, so image support can later plug in a hash of the image bytes.
 */

/**
 * Markers that password managers and other apps put on the pasteboard to ask clipboard
 * history tools not to record an item.
 *
 * macOS (nspasteboard.org convention). Verified on macOS 15 / Electron 39: these do NOT show
 * up in clipboard.availableFormats() (which only lists normalized types such as text/plain),
 * but clipboard.has(<type>) detects them. So `has()` is what we rely on.
 *
 * Windows: ExcludeClipboardContentFromMonitorProcessing and "Clipboard Viewer Ignore" are
 * registered clipboard format names. clipboard.has() with a custom name should map to
 * RegisterClipboardFormat + IsClipboardFormatAvailable, but this is untested here: verify on
 * Windows before relying on it.
 */
const PRIVACY_MARKERS: Record<string, string[]> = {
  darwin: ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType'],
  win32: ['ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore']
}

export interface WatcherOptions {
  intervalMs?: number
  /** Max text length to record; longer copies are ignored. */
  maxTextLength: number
  isPaused(): boolean
  onText(text: string): void
}

export function hashContent(data: string | Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private lastFormats = ''
  private lastText = ''
  private lastHash = ''
  /** Hash of the content we last wrote ourselves; never reported as an external copy. */
  private ownWriteHash = ''
  private readonly markers = PRIVACY_MARKERS[process.platform] ?? []

  constructor(private readonly opts: WatcherOptions) {}

  start(): void {
    if (this.timer) return
    // Whatever is on the clipboard at launch is not a new copy.
    this.snapshotBaseline()
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs ?? 400)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Write text to the clipboard on behalf of the user (picked from history). */
  writeText(text: string): void {
    clipboard.writeText(text)
    this.ownWriteHash = hashContent(text)
    this.snapshotBaseline()
  }

  /** Visible for tests: run one poll now. */
  tick(): void {
    let formats: string
    let text: string
    try {
      formats = clipboard.availableFormats().join('\n')
      text = clipboard.readText()
    } catch (err) {
      // The clipboard can be briefly locked by another process (notably on Windows).
      console.warn('[watcher] clipboard read failed:', err)
      return
    }

    // Cheap path: nothing changed since the last tick.
    if (formats === this.lastFormats && text === this.lastText) return
    this.lastFormats = formats
    this.lastText = text

    const hash = hashContent(text)
    if (hash === this.lastHash) return // e.g. same text re-copied with different formats
    this.lastHash = hash

    // Our own write only suppresses itself once; a later external copy of the same text counts.
    if (this.ownWriteHash) {
      const own = hash === this.ownWriteHash
      this.ownWriteHash = ''
      if (own) return
    }
    // Paused: we still track the signature above so resuming doesn't record what was
    // copied during the pause.
    if (this.opts.isPaused()) return
    if (!text.trim()) return
    if (text.length > this.opts.maxTextLength) return
    if (this.isConcealed()) return

    this.opts.onText(text)
  }

  private isConcealed(): boolean {
    return this.markers.some((m) => {
      try {
        return clipboard.has(m)
      } catch {
        return false
      }
    })
  }

  private snapshotBaseline(): void {
    try {
      this.lastFormats = clipboard.availableFormats().join('\n')
      this.lastText = clipboard.readText()
      this.lastHash = hashContent(this.lastText)
    } catch {
      // Next tick will retry.
    }
  }
}
