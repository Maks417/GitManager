import { useEffect, useRef } from 'react'
import type React from 'react'
import { Search, X } from 'lucide-react'
import { IconButton } from '../components/ui'

// Set by View → Find Branch while the box is not on screen (sidebar collapsed); the box takes focus on mount.
let focusOnMount = false

/** Focuses the branch filter, now or as soon as the sidebar shows it. */
export function focusBranchFilter(): void {
  const input = document.querySelector<HTMLInputElement>('[data-branch-filter]')
  if (input) {
    input.focus()
    input.select()
  } else {
    focusOnMount = true
  }
}

interface BranchFilterBoxProps {
  value: string
  onChange: (value: string) => void
}

/**
 * Narrows the local and remote branch lists as you type. Escape clears the text, a second Escape leaves
 * the box, and ↓ moves to the first branch.
 */
export function BranchFilterBox({ value, onChange }: BranchFilterBoxProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focusOnMount) return
    focusOnMount = false
    ref.current?.focus()
  }, [])

  return (
    <div className="search-field branch-filter" role="search">
      <Search className="search-field-icon" size={14} strokeWidth={1.75} aria-hidden />
      <input
        ref={ref}
        data-branch-filter
        className="search"
        aria-label="Filter branches"
        placeholder="Filter branches"
        title="Filter branches: words in any order, or * and ? as wildcards"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            if (value) onChange('')
            else e.currentTarget.blur()
          } else if (e.key === 'ArrowDown') {
            const first = e.currentTarget.closest('.sidebar')?.querySelector<HTMLElement>('.branch-list [data-roving-row]')
            if (!first) return
            e.preventDefault()
            first.focus()
          }
        }}
      />
      {value && (
        <IconButton label="Clear branch filter" className="branch-filter-clear" onClick={() => { onChange(''); ref.current?.focus() }}>
          <X size={14} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  )
}
