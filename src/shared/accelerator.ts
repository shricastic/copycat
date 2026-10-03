// Electron accelerator strings ("CommandOrControl+Shift+V"): validation, recording from DOM
// key events, and display. Shared by main (validation) and renderer (recording, display).

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'Shift',
  'Super',
  'Meta'
])

const NAMED_KEYS = new Set([
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
  'Plus'
])

const isFunctionKey = (k: string): boolean => /^F([1-9]|1\d|2[0-4])$/.test(k)

function isKey(k: string): boolean {
  return (
    /^[A-Z0-9]$/.test(k) || /^[`\-=[\]\\;',./]$/.test(k) || NAMED_KEYS.has(k) || isFunctionKey(k)
  )
}

/**
 * A usable global shortcut: modifiers followed by exactly one key, with at least one modifier
 * other than Shift (a global Shift+A would swallow every capital A). Function keys may be
 * used bare. Empty string means "no shortcut".
 */
export function isValidAccelerator(acc: string): boolean {
  if (acc === '') return true
  if (acc.length > 100) return false
  const parts = acc.split('+')
  // "Plus" is how a literal + is written, so a trailing empty part is never valid.
  const key = parts.pop()!
  if (!isKey(key)) return false
  if (parts.some((p) => !MODIFIERS.has(p))) return false
  if (new Set(parts).size !== parts.length) return false
  return parts.some((p) => p !== 'Shift') || isFunctionKey(key)
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Return',
  NumpadEnter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}

/** Key part of an accelerator from a KeyboardEvent.code (layout-independent), or null. */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (isFunctionKey(code)) return code
  return CODE_TO_KEY[code] ?? null
}

export interface KeyLike {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Build an accelerator from a key event, or null if it is only modifiers / not a usable key.
 * The platform's primary modifier (Cmd on macOS, Ctrl elsewhere) becomes CommandOrControl so
 * a saved shortcut means the same thing on both platforms.
 */
export function acceleratorFromEvent(e: KeyLike, isMac: boolean): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const parts: string[] = []
  if (isMac) {
    if (e.metaKey) parts.push('CommandOrControl')
    if (e.ctrlKey) parts.push('Control')
  } else {
    if (e.ctrlKey) parts.push('CommandOrControl')
    if (e.metaKey) parts.push('Super')
  }
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  return [...parts, key].join('+')
}

const MAC_SYMBOLS: Record<string, string> = {
  Command: '⌘',
  Cmd: '⌘',
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Super: '⌘',
  Meta: '⌘',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Return: '↩',
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: '⎋',
  Esc: '⎋',
  Tab: '⇥',
  Space: 'Space',
  Plus: '+'
}

const WIN_NAMES: Record<string, string> = {
  Command: 'Win',
  Cmd: 'Win',
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Control: 'Ctrl',
  Super: 'Win',
  Meta: 'Win',
  Option: 'Alt',
  Return: 'Enter',
  Esc: 'Escape',
  Plus: '+'
}

/** "CommandOrControl+Shift+V" -> "⌃⇧V"-style symbols on macOS, "Ctrl+Shift+V" elsewhere. */
export function formatAccelerator(acc: string, isMac: boolean): string {
  if (!acc) return ''
  const parts = acc.split('+')
  if (isMac) {
    // macOS convention orders modifiers ⌃ ⌥ ⇧ ⌘.
    const order = ['⌃', '⌥', '⇧', '⌘']
    const key = parts.pop()!
    const mods = parts.map((p) => MAC_SYMBOLS[p] ?? p)
    mods.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    return mods.join('') + (MAC_SYMBOLS[key] ?? key)
  }
  return parts.map((p) => WIN_NAMES[p] ?? p).join('+')
}
