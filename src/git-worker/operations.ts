/** Barrel re-export — keep existing `from './operations'` imports working. */
export {
  inspectRepository,
  initRepository,
  cloneRepository
} from './ops/repo'

export {
  loadHistory,
  getCommitDetail,
  getFileDiff,
  getWorkingTreeDiff
} from './ops/history'

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
  deleteBranch
} from './ops/branches'

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
