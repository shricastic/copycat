import { memo } from 'react'
import type { ClipItem } from '@shared/types'
import { compactAge, fullTime } from '../lib/relativeTime'

/** Rendering a few hundred characters is enough for a two-line preview. */
const PREVIEW_CHARS = 400

interface Props {
  item: ClipItem
  index: number
  selected: boolean
  /** Last pinned row before unpinned ones: draws the divider under it. */
  lastPinned: boolean
  now: number
  /** Hover: the parent ignores it until the pointer has really moved. */
  onHover(index: number): void
  onSelect(index: number): void
  onPaste(id: string): void
  onMenu(id: string): void
}

function countLines(text: string): number {
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

export const HistoryItem = memo(function HistoryItem({
  item,
  index,
  selected,
  lastPinned,
  now,
  onHover,
  onSelect,
  onPaste,
  onMenu
}: Props): React.JSX.Element {
  // Leading/trailing blank lines (browsers often append a newline) don't count as content.
  const trimmed = item.text.trim()
  const preview = trimmed.slice(0, PREVIEW_CHARS)
  const lines = countLines(trimmed)

  return (
    <li
      id={`item-${item.id}`}
      role="option"
      aria-selected={selected}
      className={`item${selected ? ' selected' : ''}${lastPinned ? ' last-pinned' : ''}`}
      onMouseMove={() => !selected && onHover(index)}
      onClick={() => onPaste(item.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(index)
        onMenu(item.id)
      }}
    >
      <div className="item-body">
        {/* Multi-line copies are usually code or structured text: keep their indentation legible. */}
        <div className={`item-text${lines > 1 ? ' mono' : ''}`}>{preview}</div>
      </div>

      {/* Same slot: the age (or a pin for pinned items) at rest, a copy button on hover. */}
      <div className="item-aside">
        {item.pinned ? (
          <svg className="item-pin" viewBox="0 0 16 16" role="img" aria-label="Pinned">
            <path d="M9.6 1.9 14.1 6.4a.6.6 0 0 1-.25 1L11.2 8.2 8.9 10.5l.35 2.6a.6.6 0 0 1-1 .5L2.4 7.75a.6.6 0 0 1 .5-1l2.6.35L7.8 4.8 8.6 2.15a.6.6 0 0 1 1-.25Z" />
            <path d="M5.3 10.7 1.75 14.25" />
          </svg>
        ) : (
          <time className="item-age" dateTime={new Date(item.createdAt).toISOString()}>
            {compactAge(item.createdAt, now)}
          </time>
        )}
        <button
          className="item-copy"
          // The age is hidden while hovering, so the exact time lives in this tooltip.
          title={`Copy (copied ${fullTime(item.createdAt)})`}
          aria-label="Copy to clipboard"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onPaste(item.id)
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="2" />
            <path d="M10.75 3.25v-.5a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h.5" />
          </svg>
        </button>
      </div>
    </li>
  )
})
