import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import { DEFAULT_SETTINGS, MAX_HISTORY_LIMIT, type ClipItem, type Settings } from '@shared/types'

/**
 * Persistence and history operations behind a small interface, so the JSON file can later be
 * swapped for SQLite without touching callers.
 *
 * Writes are debounced and done synchronously (write temp file, then rename over the target).
 * The data is small (<= MAX_HISTORY_LIMIT items), so a sync write costs ~1 ms, and it avoids
 * the race where an in-flight async rename lands after the final flush on quit.
 */

const FILE_VERSION = 1
const SAVE_DEBOUNCE_MS = 500
/** Texts longer than this are not recorded (keeps the file, IPC and search reasonable). */
export const MAX_TEXT_LENGTH = 256 * 1024

interface FileShape {
  version: number
  settings: Settings
  history: ClipItem[]
}

export interface StoreEvents {
  history: [ClipItem[]]
  settings: [Settings]
}

export class Store extends EventEmitter<StoreEvents> {
  private history: ClipItem[] = []
  private settings: Settings = { ...DEFAULT_SETTINGS }
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(private readonly file: string) {
    super()
  }

  load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<FileShape>
      this.settings = sanitizeSettings(raw.settings)
      this.history = sanitizeHistory(raw.history)
      // Apply the cap in case maxHistory was lowered by hand-editing the file.
      this.history = enforceCap(this.history, this.settings.maxHistory)
    } catch (err) {
      // Keep the unreadable file for inspection rather than overwriting it silently.
      const backup = `${this.file}.corrupt-${Date.now()}`
      console.error(`[store] could not read ${this.file}, moved to ${backup}:`, err)
      try {
        renameSync(this.file, backup)
      } catch {
        // ignore
      }
    }
  }

  // ---------- reads ----------

  getHistory(): ClipItem[] {
    return this.history
  }

  getSettings(): Settings {
    return this.settings
  }

  // ---------- history operations ----------

  /** Record an external copy. Existing text moves to the top instead of being duplicated. */
  addText(text: string, now = Date.now()): void {
    const existing = this.history.find((i) => i.text === text)
    const item: ClipItem = existing
      ? { ...existing, createdAt: now }
      : { id: randomUUID(), text, createdAt: now, pinned: false }
    const rest = this.history.filter((i) => i !== existing)
    this.setHistory(enforceCap([item, ...rest], this.settings.maxHistory))
  }

  remove(id: string): void {
    const next = this.history.filter((i) => i.id !== id)
    if (next.length !== this.history.length) this.setHistory(next)
  }

  togglePin(id: string): void {
    if (!this.history.some((i) => i.id === id)) return
    this.setHistory(this.history.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)))
  }

  /** Remove all unpinned items. Pinned items are only removed by deleting them explicitly. */
  clearUnpinned(): void {
    this.setHistory(this.history.filter((i) => i.pinned))
  }

  findById(id: string): ClipItem | undefined {
    return this.history.find((i) => i.id === id)
  }

  // ---------- settings ----------

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    this.emit('settings', this.settings)
    if (patch.maxHistory !== undefined) {
      this.setHistory(enforceCap(this.history, this.settings.maxHistory))
    }
    this.scheduleSave()
    return this.settings
  }

  // ---------- persistence ----------

  private setHistory(next: ClipItem[]): void {
    this.history = next
    this.emit('history', next)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS)
  }

  /** Write pending changes now. Safe to call repeatedly; called on before-quit. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    const data: FileShape = {
      version: FILE_VERSION,
      settings: this.settings,
      history: this.history
    }
    const tmp = `${this.file}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(tmp, JSON.stringify(data), 'utf8')
      renameSync(tmp, this.file) // atomic on the same volume (POSIX rename / MoveFileEx)
      this.dirty = false
    } catch (err) {
      console.error('[store] save failed:', err)
      try {
        unlinkSync(tmp)
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Keep at most `max` unpinned items (newest first). Pinned items never count against the cap
 * and are never evicted.
 */
export function enforceCap(items: ClipItem[], max: number): ClipItem[] {
  let unpinned = 0
  return items.filter((i) => i.pinned || ++unpinned <= max)
}

function sanitizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Record<string, unknown>
  if (isValidMaxHistory(r.maxHistory)) s.maxHistory = r.maxHistory
  if (typeof r.shortcut === 'string' && r.shortcut.length <= 100) s.shortcut = r.shortcut
  if (typeof r.launchAtLogin === 'boolean') s.launchAtLogin = r.launchAtLogin
  if (typeof r.paused === 'boolean') s.paused = r.paused
  if (typeof r.clearOnQuit === 'boolean') s.clearOnQuit = r.clearOnQuit
  return s
}

function sanitizeHistory(raw: unknown): ClipItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ClipItem[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { id, text, createdAt, pinned } = r as Record<string, unknown>
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push({
      id: typeof id === 'string' && id ? id : randomUUID(),
      text,
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
      pinned: pinned === true
    })
  }
  return out
}

export function isValidMaxHistory(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_HISTORY_LIMIT
}
