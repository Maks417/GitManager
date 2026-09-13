import type React from 'react'

interface Option<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
  hint?: string
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  disabled = false
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div className={['segmented', className].filter(Boolean).join(' ')} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const hint = opt.hint ?? opt.label
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            className={[value === opt.value ? 'active' : '', opt.icon ? 'btn-icon' : '', 'has-hint']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={value === opt.value}
            aria-label={opt.label}
            title={hint}
            data-hint={hint}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
