/**
 * Shared map of git-worker RPC method names → operation functions.
 * Used by both utilityProcess handlers and the inline client fallback.
 */
import {
  checkoutRef,
  checkoutRemoteBranch,
  cloneRepository,
  commit,
  createBranch,
  deleteBranch,
  discardPaths,
  fetchRemote,
  getBranches,
  getCommitDetail,
  getFileDiff,
  getGitIdentity,
  getMergeSides,
  getRemoteBranches,
  getStatus,
  getWorkingTreeDiff,
  initRepository,
  inspectRepository,
  isRebaseInProgress,
  listConflictFiles,
  listStashes,
  loadHistory,
  mergeRef,
  pullRemote,
  pushRemote,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto,
  saveMergeResult,
  setGitIdentity,
  stagePaths,
  stashApply,
  stashDrop,
  stashPop,
  stashSave,
  unstagePaths
} from './operations'

export const GIT_METHODS = {
  inspectRepository,
  initRepository,
  cloneRepository,
  loadHistory,
  getCommitDetail,
  getFileDiff,
  getWorkingTreeDiff,
  getStatus,
  getBranches,
  getRemoteBranches,
  stagePaths,
  unstagePaths,
  discardPaths,
  commit,
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
  deleteBranch,
  stashSave,
  listStashes,
  stashApply,
  stashPop,
  stashDrop,
  listConflictFiles,
  getMergeSides,
  saveMergeResult,
  getGitIdentity,
  setGitIdentity
} as const

export type GitMethodName = keyof typeof GIT_METHODS

export function getGitMethod(method: string): ((...args: never[]) => unknown) | undefined {
  return GIT_METHODS[method as GitMethodName] as ((...args: never[]) => unknown) | undefined
}
