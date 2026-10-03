import { memo } from 'react'
import type { ClipItem } from '@shared/types'
import { relativeTime } from '../lib/relativeTime'

/** Rendering a few hundred characters is enough for a two-line preview. */
const PREVIEW_CHARS = 400

interface Props {
  item: ClipItem
  index: number
  selected: boolean
  now: number
  onSelect(index: number): void
  onPaste(id: string): void
  onDelete(id: string): void
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
  now,
  onSelect,
  onPaste,
  onDelete
}: Props): React.JSX.Element {
  const preview = item.text.trimStart().slice(0, PREVIEW_CHARS)
  const lines = countLines(item.text)

  return (
    <li
      id={`item-${item.id}`}
      role="option"
      aria-selected={selected}
      className={`item${selected ? ' selected' : ''}`}
      // mousemove (not mouseenter) so keyboard scrolling doesn't steal the selection.
      onMouseMove={() => !selected && onSelect(index)}
      onClick={() => onPaste(item.id)}
    >
      <div className="item-text">{preview}</div>
      <div className="item-meta">
        <span>{relativeTime(item.createdAt, now)}</span>
        {lines > 1 && <span>{lines} lines</span>}
      </div>
      <button
        className="item-delete"
        title="Delete"
        aria-label="Delete item"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(item.id)
        }}
      >
        ×
      </button>
    </li>
  )
})
