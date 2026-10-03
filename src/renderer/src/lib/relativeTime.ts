const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const YEAR = 365 * DAY

/** Compact age for the row's right edge: "5s", "1m", "3h", "2d", "4w", "1y". */
export function compactAge(then: number, now: number): string {
  const diff = Math.max(0, now - then)
  if (diff < MINUTE) return `${Math.max(1, Math.floor(diff / SECOND))}s`
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`
  if (diff < YEAR) return `${Math.floor(diff / WEEK)}w`
  return `${Math.floor(diff / YEAR)}y`
}

/** Full timestamp for the tooltip. */
export function fullTime(then: number): string {
  return new Date(then).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
