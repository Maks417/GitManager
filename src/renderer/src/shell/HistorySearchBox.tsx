import { useMemo, useState } from 'react'
import type React from 'react'
import { GitBranch, Search } from 'lucide-react'
import { branchQueryAt, suggestBranches, withBranchFilter } from '../logic/branch-suggest'
import { useHistoryActions, useHistoryState } from '../state/HistoryProvider'
import { useSession } from '../state/RepoSessionProvider'

const LISTBOX_ID = 'history-search-branches'
const optionId = (index: number): string => `history-search-branch-${index}`
const ALT_KEY = /Mac/i.test(navigator.userAgent) ? 'Option' : 'Alt'

interface BranchSuggestion {
  name: string
  remote: string | null
  sha: string | null
}

/**
 * The history search box. Its last word suggests matching branches: Enter turns the highlighted one
 * into a `branch:` filter, Alt+Enter jumps to its tip, and Enter without a highlight searches as typed.
 */
export function HistorySearchBox({ disabled }: { disabled: boolean }): React.JSX.Element {
  const { search } = useHistoryState()
  const { setSearch, submitSearch, revealCommit, searchInputRef } = useHistoryActions()
  const { branches, remoteBranches } = useSession()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const allBranches = useMemo<BranchSuggestion[]>(
    () => [
      ...branches.map((b) => ({ name: b.name, remote: null, sha: b.sha })),
      ...remoteBranches.map((b) => ({ name: b.name, remote: b.remote, sha: b.sha }))
    ],
    [branches, remoteBranches]
  )
  const query = useMemo(() => branchQueryAt(search), [search])
  const suggestions = useMemo(
    () => (query ? suggestBranches(query.text, allBranches) : []),
    [query, allBranches]
  )
  const expanded = open && suggestions.length > 0
  const active = expanded ? (suggestions[highlight] ?? null) : null

  const close = (): void => {
    setOpen(false)
    setHighlight(-1)
  }

  const showBranch = (branch: BranchSuggestion): void => {
    if (!query) return
    const next = withBranchFilter(search, query, branch.name)
    close()
    setSearch(next)
    submitSearch(next)
  }

  const jumpToTip = (branch: BranchSuggestion): void => {
    close()
    if (branch.sha) void revealCommit(branch.sha, branch.name)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const count = suggestions.length
      setOpen(true)
      setHighlight((current) =>
        !expanded || current < 0 ? (step === 1 ? 0 : count - 1) : (current + step + count) % count
      )
    } else if (e.key === 'Enter' && active) {
      e.preventDefault()
      if (e.altKey) jumpToTip(active)
      else showBranch(active)
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault()
      close()
    }
  }

  return (
    <form
      className="spacer search-form"
      role="search"
      data-pane="search"
      onSubmit={(e) => {
        e.preventDefault()
        close()
        submitSearch()
      }}
    >
      <div className="search-field">
        <Search className="search-field-icon" size={16} strokeWidth={1.75} aria-hidden />
        <input
          ref={searchInputRef}
          className="search"
          role="combobox"
          aria-label="Search commits"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? LISTBOX_ID : undefined}
          aria-activedescendant={active ? optionId(highlight) : undefined}
          placeholder="Search messages, SHA, author:name or branch:name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
            setHighlight(-1)
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
          disabled={disabled}
          title="Search commits"
          autoComplete="off"
          spellCheck={false}
        />
        {expanded && (
          <div className="search-suggestions">
            <ul id={LISTBOX_ID} role="listbox" aria-label="Branches">
              {suggestions.map((branch, index) => (
                <li
                  key={`${branch.remote === null ? 'local' : 'remote'}:${branch.name}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? 'active' : undefined}
                  // Keep focus in the search box.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setHighlight(index)}
                  onClick={(e) => (e.altKey ? jumpToTip(branch) : showBranch(branch))}
                >
                  <GitBranch size={14} strokeWidth={1.75} aria-hidden />
                  <span className="cell-ellipsis">{branch.name}</span>
                  <span className="muted text-xs">{branch.remote === null ? 'local' : 'remote'}</span>
                </li>
              ))}
            </ul>
            <div className="search-suggestions-hint muted text-xs">
              Enter shows the branch · {ALT_KEY}+Enter jumps to its tip
            </div>
          </div>
        )}
      </div>
    </form>
  )
}
