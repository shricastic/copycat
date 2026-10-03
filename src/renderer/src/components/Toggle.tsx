interface Props {
  checked: boolean
  disabled?: boolean
  label: string
  onChange(checked: boolean): void
}

/** Native-style switch. A real checkbox underneath, so it is keyboard and screen-reader friendly. */
export function Toggle({ checked, disabled, label, onChange }: Props): React.JSX.Element {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  )
}
