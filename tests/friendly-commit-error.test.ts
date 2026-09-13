import { describe, expect, it } from 'vitest'
import { friendlyCommitError } from '../src/git-worker/operations'

describe('friendlyCommitError', () => {
  it('guides the user when the index is empty but the worktree has changes', () => {
    const raw = [
      'On branch master',
      "Your branch is up to date with 'origin/master'.",
      'Changes not staged for commit:',
      '  modified:   README.md',
      'Untracked files:',
      '  LICENSE',
      'no changes added to commit (use "git add" and/or "git commit -a")'
    ].join('\n')
    expect(friendlyCommitError(raw)).toBe(
      'Nothing is staged. Select files under Changes, click Stage or Stage all, then commit.'
    )
  })

  it('reports a clean working tree', () => {
    expect(friendlyCommitError('On branch main\nnothing to commit, working tree clean')).toBe(
      'Nothing to commit — the working tree is clean.'
    )
  })

  it('keeps unrelated git stderr intact', () => {
    expect(friendlyCommitError('Author identity unknown')).toBe('Author identity unknown')
  })
})
