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
  stagePaths,
  unstagePaths,
  discardPaths,
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
  isRebaseInProgress,
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
  saveMergeResult
} from './ops/merge'

export { getGitIdentity, setGitIdentity } from './ops/identity'
