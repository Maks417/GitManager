import type { ConfirmRequest } from '../logic/confirm-queue'

export const CONFIRM_ABORT_REBASE: ConfirmRequest = {
  title: 'Abort rebase',
  message: 'Abort the in-progress rebase? The branch returns to where it was before the rebase started.',
  confirmLabel: 'Abort rebase',
  danger: true
}

export const CONFIRM_ABORT_MERGE: ConfirmRequest = {
  title: 'Abort merge',
  message:
    'Abort the merge? Conflict resolutions made so far are discarded and the branch returns to where it was before the merge.',
  confirmLabel: 'Abort merge',
  danger: true
}

export const CONFIRM_DISCARD: ConfirmRequest = {
  title: 'Discard changes',
  message:
    'Discard changes in the selected files?\n\nModified files go back to their staged or committed version. Untracked files are moved to the Trash.',
  confirmLabel: 'Discard',
  danger: true
}

export const confirmDiscardPart = (what: 'hunk' | 'lines', path: string): ConfirmRequest => ({
  title: what === 'hunk' ? 'Discard hunk' : 'Discard lines',
  message: `Discard the ${what === 'hunk' ? 'selected hunk' : 'selected changed lines'} in ${path}?

Those lines go back to their staged or committed version. This cannot be undone.`,
  confirmLabel: 'Discard',
  danger: true
})

export const confirmAbortSequencer = (kind: 'cherry-pick' | 'revert'): ConfirmRequest => ({
  title: `Abort ${kind}`,
  message: `Abort the ${kind}? Conflict resolutions made so far are discarded and the branch returns to where it was before.`,
  confirmLabel: `Abort ${kind}`,
  danger: true
})

export const confirmCheckoutCommit = (shortSha: string): ConfirmRequest => ({
  title: 'Check out commit',
  message: `Check out ${shortSha}?\n\nHEAD will be detached: new commits belong to no branch until you create one. Uncommitted changes are carried over when Git can do so safely.`,
  confirmLabel: 'Check out'
})

export const confirmCherryPick = (shortSha: string, subject: string, branch: string): ConfirmRequest => ({
  title: 'Cherry-pick',
  message: `Apply ${shortSha} “${subject}” on top of ${branch} as a new commit?`,
  confirmLabel: 'Cherry-pick'
})

export const confirmRevert = (shortSha: string, subject: string, branch: string): ConfirmRequest => ({
  title: 'Revert',
  message: `Add a commit to ${branch} that undoes ${shortSha} “${subject}”?`,
  confirmLabel: 'Revert'
})

export const confirmDeleteTag = (name: string, onRemote: boolean): ConfirmRequest => ({
  title: onRemote ? 'Delete tag on remote' : 'Delete tag',
  message: onRemote
    ? `Delete the tag ${name} on the remote? Others who fetched it keep their copy.`
    : `Delete the tag ${name} in this repository? A copy pushed to a remote stays there.`,
  confirmLabel: 'Delete tag',
  danger: true
})

export const confirmMerge = (ref: string): ConfirmRequest => ({
  title: 'Merge',
  message: `Merge ${ref} into the current branch?`,
  confirmLabel: 'Merge'
})

export const confirmRebase = (ref: string): ConfirmRequest => ({
  title: 'Rebase',
  message: `Rebase the current branch onto ${ref}?`,
  confirmLabel: 'Rebase'
})

export const confirmDeleteBranch = (name: string): ConfirmRequest => ({
  title: 'Delete branch',
  message: `Delete branch "${name}"?`,
  confirmLabel: 'Delete',
  danger: true
})

export const confirmForceDeleteBranch = (name: string, reason: string): ConfirmRequest => ({
  title: 'Force delete branch',
  message: `${reason}\n\nForce delete branch "${name}"? Commits that exist only on this branch will no longer be on any branch.`,
  confirmLabel: 'Force delete',
  danger: true
})

export const confirmDropStash = (selector: string): ConfirmRequest => ({
  title: 'Drop stash',
  message: `Drop ${selector}? Its changes cannot be restored from the app.`,
  confirmLabel: 'Drop',
  danger: true
})

export const confirmResolveByDeleting = (path: string): ConfirmRequest => ({
  title: 'Resolve by deleting',
  message: `Resolve the conflict by deleting ${path}?`,
  confirmLabel: 'Delete file',
  danger: true
})

export const COMMIT_TOO_DEEP = 'That commit is more than 10,000 commits down the history, too far to jump to.'

export const branchTipTooDeep = (branch: string): string =>
  `The tip of ${branch} is more than 10,000 commits down the history, so only ${branch} is shown.`

export const branchNotOnCurrentBranch = (branch: string): string =>
  `The tip of ${branch} is not in the current branch's history, so only ${branch} is shown.`

export const GIT_MISSING_MESSAGE =
  'Git was not found on this computer. Install Git from https://git-scm.com/downloads, then restart Git Manager.'

export const CLONE_URL_SESSION_KEY = 'gm.cloneUrl'

export const MONACO_FONT_FAMILY = 'IBM Plex Mono, Cascadia Code, Consolas, monospace'
