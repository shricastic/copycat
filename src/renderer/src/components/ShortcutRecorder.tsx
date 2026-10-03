import { useEffect, useRef, useState } from 'react'
import { acceleratorFromEvent, formatAccelerator, isValidAccelerator } from '@shared/accelerator'

interface Props {
  value: string
  isMac: boolean
  /** Saves the shortcut; resolves to an error message if main rejected it. */
  onChange(accelerator: string): Promise<string | undefined>
}

const MODIFIER_CODES = /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/

/**
 * Click, then press the new key combination. Esc cancels, Backspace/Delete removes the
 * shortcut. While recording, main suspends the current global shortcut and menu
 * accelerators so every combination reaches this element.
 */
export function ShortcutRecorder({ value, isMac, onChange }: Props): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')
  const ref = useRef<HTMLButtonElement>(null)

  const stop = (): void => {
    setRecording(false)
    setHint('')
    window.api.setShortcutRecording(false)
  }

  const start = (): void => {
    setRecording(true)
    setHint('')
    window.api.setShortcutRecording(true)
    ref.current?.focus()
  }

  // Never leave the global shortcut suspended if this unmounts mid-recording.
  useEffect(() => {
    if (!recording) return
    return () => {
      window.api.setShortcutRecording(false)
    }
  }, [recording])

  const save = async (acc: string): Promise<void> => {
    stop()
    const error = await onChange(acc)
    if (error) setHint(error)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!recording) return
    // Keep the app-level handlers (Esc closes, arrows navigate) out of this.
    e.preventDefault()
    e.stopPropagation()
    const ev = e.nativeEvent
    const hasModifier = ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey

    if (ev.code === 'Escape' && !hasModifier) return stop()
    if ((ev.code === 'Backspace' || ev.code === 'Delete') && !hasModifier) {
      void save('')
      return
    }
    if (MODIFIER_CODES.test(ev.code)) return // wait for the actual key

    const acc = acceleratorFromEvent(ev, isMac)
    if (!acc) return setHint('That key can’t be used in a shortcut.')
    if (!isValidAccelerator(acc)) {
      // Shift alone isn't enough: the shortcut would swallow normal typing.
      return setHint(isMac ? 'Include ⌘, ⌃ or ⌥.' : 'Include Ctrl or Alt.')
    }
    void save(acc)
  }

  return (
    <div className="shortcut">
      <button
        ref={ref}
        className={`shortcut-field${recording ? ' recording' : ''}`}
        onClick={() => (recording ? stop() : start())}
        onKeyDown={onKeyDown}
        onBlur={() => recording && stop()}
        aria-label={recording ? 'Press the new shortcut' : 'Change shortcut'}
      >
        {recording ? 'Press keys…' : formatAccelerator(value, isMac) || 'None'}
      </button>
      {hint && <div className="setting-hint error">{hint}</div>}
    </div>
  )
}
