/** Barrel re-export — keep existing `from './operations'` imports working. */
export {
  inspectRepository,
  createRepository,
  cloneRepository,
  getDefaultBranchName,
  getEnclosingWorkTree,
  getGitDirs
} from './ops/repo'

export {
  loadHistory,
  getCommitDetail,
  getFileDiff,
  getWorkingTreeDiff
} from './ops/history'

export { applyPartial } from './ops/patch'

export { getFileHistory, getBlame } from './ops/file-history'

export {
  getStatus,
  filterIgnoredPaths,
  stagePaths,
  unstagePaths,
  planDiscard,
  restoreWorktree,
  friendlyCommitError,
  commit
} from './ops/status'

export {
  getBranches,
  getRemoteBranches,
  fetchRemote,
  pullRemote,
  pushRemote,
  forcePushRemote,
  checkoutRef,
  checkoutRemoteBranch,
  createBranch,
  mergeRef,
  rebaseOnto,
  rebaseContinue,
  rebaseAbort,
  rebaseSkip,
  isRebaseInProgress,
  isMergeInProgress,
  mergeAbort,
  friendlyPushError,
  deleteBranch,
  pushTag
} from './ops/branches'

export {
  cherryPickCommit,
  revertCommit,
  getSequencerOp,
  sequencerStep,
  countCommitsAfter,
  resetToCommit,
  createTag,
  deleteTag
} from './ops/commits'

export {
  stashSave,
  listStashes,
  stashApply,
  stashPop,
  stashDrop
} from './ops/stash'

export {
  listConflictFiles,
  getMergeSides,
  saveMergeResult,
  resolveConflictSide
} from './ops/merge'

export { getGitIdentity, setGitIdentity } from './ops/identity'

export { inspectRepoForRemoval } from './ops/removal'

export { getWatchFingerprint } from './ops/watch'

export { getWorktreeInfo, pruneWorktree } from './ops/worktrees'
