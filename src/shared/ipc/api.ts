import type {
  AppInfo,
  AppPreferences,
  BranchInfo,
  CloneRequest,
  CommitDetail,
  ConflictFile,
  ConflictSide,
  DiffRequest,
  DiffResult,
  GitIdentity,
  GitProbeResult,
  HistoryPage,
  HistoryQuery,
  MergeSides,
  ProviderAccount,
  RemoteBranchInfo,
  RemoteRepo,
  RepoRemovalInfo,
  Repository,
  RepoWatchEvent,
  SetGitIdentityRequest,
  StashEntry,
  StatusEntry,
  UpdateStatus,
  WorkingTreeDiffRequest
} from './schemas'
import type { ProviderId } from '../providers'

export interface GitManagerApi {
  repo: {
    list: () => Promise<Repository[]>
    add: (path: string) => Promise<Repository>
    remove: (id: string, options?: { deleteFiles?: boolean }) => Promise<void>
    openDialog: () => Promise<Repository | null>
    create: (path: string) => Promise<Repository>
    clone: (request: CloneRequest) => Promise<Repository>
    get: (id: string) => Promise<Repository | null>
    status: (repoPath: string) => Promise<StatusEntry[]>
    branches: (repoPath: string) => Promise<BranchInfo[]>
    remoteBranches: (repoPath: string) => Promise<RemoteBranchInfo[]>
    pickDirectory: () => Promise<string | null>
    /** Start recursive FS watch for live status (Windows + macOS). */
    watch: (repoPath: string) => Promise<void>
    unwatch: () => Promise<void>
    onChanged: (callback: (event: RepoWatchEvent) => void) => () => void
    /** Uncommitted / stashed / unpushed work that deleting the folder would lose. */
    removalInfo: (id: string) => Promise<RepoRemovalInfo & { path: string }>
  }
  history: {
    load: (query: HistoryQuery) => Promise<HistoryPage>
    commitDetail: (repoPath: string, sha: string) => Promise<CommitDetail>
    fileDiff: (request: DiffRequest) => Promise<DiffResult>
    workingTreeDiff: (request: WorkingTreeDiffRequest) => Promise<DiffResult>
  }
  git: {
    probe: () => Promise<GitProbeResult>
    stage: (repoPath: string, paths: string[]) => Promise<void>
    unstage: (repoPath: string, paths: string[]) => Promise<void>
    commit: (repoPath: string, message: string, amend?: boolean) => Promise<string>
    fetch: (repoPath: string) => Promise<void>
    pull: (repoPath: string) => Promise<void>
    push: (repoPath: string) => Promise<void>
    checkout: (repoPath: string, ref: string) => Promise<void>
    checkoutRemoteBranch: (repoPath: string, remoteRef: string) => Promise<void>
    createBranch: (repoPath: string, name: string, checkout?: boolean) => Promise<void>
    deleteBranch: (repoPath: string, name: string, force?: boolean) => Promise<void>
    merge: (repoPath: string, ref: string) => Promise<{ conflicts: string[] }>
    rebase: (repoPath: string, upstream: string) => Promise<{ conflicts: string[] }>
    rebaseContinue: (repoPath: string) => Promise<{ conflicts: string[] }>
    rebaseAbort: (repoPath: string) => Promise<void>
    rebaseInProgress: (repoPath: string) => Promise<boolean>
    rebaseSkip: (repoPath: string) => Promise<{ conflicts: string[] }>
    mergeAbort: (repoPath: string) => Promise<void>
    mergeInProgress: (repoPath: string) => Promise<boolean>
    stash: (repoPath: string, message?: string) => Promise<void>
    stashList: (repoPath: string) => Promise<StashEntry[]>
    stashApply: (repoPath: string, ref?: string) => Promise<void>
    stashPop: (repoPath: string, ref?: string) => Promise<void>
    stashDrop: (repoPath: string, ref?: string) => Promise<void>
    discard: (repoPath: string, paths: string[]) => Promise<void>
    getIdentity: (repoPath: string) => Promise<GitIdentity>
    setIdentity: (request: SetGitIdentityRequest) => Promise<GitIdentity>
  }
  merge: {
    listConflicts: (repoPath: string) => Promise<ConflictFile[]>
    getSides: (repoPath: string, path: string) => Promise<MergeSides>
    saveResult: (repoPath: string, path: string, content: string) => Promise<void>
    /** Take one side as the whole file (or the deletion, when that side deleted it) and stage it. */
    resolveSide: (repoPath: string, path: string, side: ConflictSide) => Promise<void>
  }
  providers: {
    listAccounts: () => Promise<ProviderAccount[]>
    disconnect: (accountId: string) => Promise<void>
    listRepos: (accountId: string) => Promise<RemoteRepo[]>
    saveToken: (
      provider: ProviderId,
      token: string,
      username?: string
    ) => Promise<ProviderAccount>
  }
  prefs: {
    get: () => Promise<AppPreferences>
    set: (prefs: Partial<AppPreferences>) => Promise<AppPreferences>
  }
  updater: {
    status: () => Promise<UpdateStatus>
    check: () => Promise<UpdateStatus>
    install: () => Promise<void>
    onStatus: (callback: (status: UpdateStatus) => void) => () => void
  }
  app: {
    getInfo: () => Promise<AppInfo>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
}

declare global {
  interface Window {
    gitManager: GitManagerApi
  }
}

export {}
