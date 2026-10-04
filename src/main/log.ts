import { app } from 'electron'
import { appendFileSync, renameSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Tiny diagnostic log: JSON lines in copycat.log next to the history file. Only unusual
 * events are written (e.g. the popup found off screen), so problems that can't be reproduced
 * on demand leave a trace. Capped: past MAX_BYTES the file is rotated to copycat.log.old.
 */

const MAX_BYTES = 256 * 1024
let file: string | null = null

export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  try {
    file ??= join(app.getPath('userData'), 'copycat.log')
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`)
    } catch {
      // no log file yet
    }
    appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n')
  } catch {
    // Diagnostics must never break the app.
  }
}

export function getLogPath(): string {
  return file ?? join(app.getPath('userData'), 'copycat.log')
}
