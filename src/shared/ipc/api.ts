import type {
  AppInfo,
  BlameResult,
  FileHistoryPage,
  ApplyPartialRequest,
  AppPreferences,
  BranchInfo,
  CloneRequest,
  CloneResult,
  CommitDetail,
  ConflictFile,
  ConflictSide,
  CreateRepoRequest,
  CreateRepoResult,
  DiffRequest,
  DiffResult,
  GitIdentity,
  GitProbeResult,
  GitProgress,
  HistoryPage,
  HistoryQuery,
  MergeSides,
  NewRepoTarget,
  NewRepoTargetRequest,
  ProviderAccount,
  RemoteBranchInfo,
  RemoteOpRequest,
  RemoteOpResult,
  RemoteRepo,
  RepoRefreshRequest,
  RepoRemovalInfo,
  ResetMode,
  SequencerOp,
  SequencerStep,
  TagPushRequest,
  RepoRemoveOptions,
  RepoRemoveResult,
  Repository,
  RepoSessionSnapshot,
  RepoWatchEvent,
  RepoWatchState,
  SetGitIdentityRequest,
  StashEntry,
  StatusEntry,
  UpdateStatus,
  WorkingTreeDiffRequest,
  WorktreeInfo
} from './schemas'
import type { ProviderId } from '../providers'

export interface GitManagerApi {
  repo: {
    list: () => Promise<Repository[]>
    add: (path: string) => Promise<Repository>
    /** Drop from the list; optionally move the folder to the Trash and prune a linked worktree's record. */
    remove: (id: string, options?: RepoRemoveOptions) => Promise<RepoRemoveResult>
    openDialog: () => Promise<Repository | null>
    /** Create a repository folder, initialize it and add it to the list. */
    create: (request: CreateRepoRequest) => Promise<CreateRepoResult>
    /** Check where a new repository would go, without writing anything. */
    inspectNewRepo: (request: NewRepoTargetRequest) => Promise<NewRepoTarget>
    /** Progress arrives through `git.onProgress`; `git.cancelOperation(opId)` stops it and removes the folder. */
    clone: (request: CloneRequest) => Promise<CloneResult>
    get: (id: string) => Promise<Repository | null>
    /** One coalesced status/meta refresh for the live-watch hot path. */
    refresh: (request: RepoRefreshRequest) => Promise<RepoSessionSnapshot>
    status: (repoPath: string) => Promise<StatusEntry[]>
    branches: (repoPath: string) => Promise<BranchInfo[]>
    remoteBranches: (repoPath: string) => Promise<RemoteBranchInfo[]>
    pickDirectory: () => Promise<string | null>
    /** Watch the repository for changes; resolves how it is watched (null when live status is off). */
    watch: (repoPath: string) => Promise<RepoWatchState | null>
    unwatch: () => Promise<void>
    onChanged: (callback: (event: RepoWatchEvent) => void) => () => void
    /** A watch changed mode, e.g. to polling when the system refused more watches; null when stopped. */
    onWatchState: (callback: (state: RepoWatchState | null) => void) => () => void
    /** Uncommitted / stashed / unpushed work that deleting the folder would lose. */
    removalInfo: (id: string) => Promise<RepoRemovalInfo & { path: string }>
    /** Whether the folder exists and how it relates to other worktrees; quick, unlike removalInfo. */
    worktreeInfo: (id: string) => Promise<WorktreeInfo>
  }
  history: {
    load: (query: HistoryQuery) => Promise<HistoryPage>
    commitDetail: (repoPath: string, sha: string) => Promise<CommitDetail>
    fileDiff: (request: DiffRequest) => Promise<DiffResult>
    workingTreeDiff: (request: WorkingTreeDiffRequest) => Promise<DiffResult>
    /** Commits that changed a file, newest first, across renames; `skip` pages through them. */
    fileHistory: (repoPath: string, path: string, skip?: number) => Promise<FileHistoryPage>
    /** At a commit, or in the work tree when `rev` is omitted. */
    blame: (repoPath: string, path: string, rev?: string) => Promise<BlameResult>
  }
  git: {
    probe: () => Promise<GitProbeResult>
    stage: (repoPath: string, paths: string[]) => Promise<void>
    unstage: (repoPath: string, paths: string[]) => Promise<void>
    applyPartial: (request: ApplyPartialRequest) => Promise<void>
    commit: (repoPath: string, message: string, amend?: boolean) => Promise<string>
    /** Network operations report progress through `onProgress` and stop with `cancelOperation(opId)`. */
    fetch: (request: RemoteOpRequest) => Promise<RemoteOpResult>
    pull: (request: RemoteOpRequest) => Promise<RemoteOpResult>
    push: (request: RemoteOpRequest) => Promise<RemoteOpResult>
    cancelOperation: (opId: string) => Promise<void>
    onProgress: (callback: (progress: GitProgress) => void) => () => void
    checkout: (repoPath: string, ref: string) => Promise<void>
    checkoutRemoteBranch: (repoPath: string, remoteRef: string) => Promise<void>
    /** At HEAD, or at `startPoint` when given. */
    createBranch: (repoPath: string, name: string, checkout?: boolean, startPoint?: string) => Promise<void>
    deleteBranch: (repoPath: string, name: string, force?: boolean) => Promise<void>
    merge: (repoPath: string, ref: string) => Promise<{ conflicts: string[] }>
    rebase: (repoPath: string, upstream: string) => Promise<{ conflicts: string[] }>
    rebaseContinue: (repoPath: string) => Promise<{ conflicts: string[] }>
    rebaseAbort: (repoPath: string) => Promise<void>
    rebaseInProgress: (repoPath: string) => Promise<boolean>
    rebaseSkip: (repoPath: string) => Promise<{ conflicts: string[] }>
    mergeAbort: (repoPath: string) => Promise<void>
    mergeInProgress: (repoPath: string) => Promise<boolean>
    cherryPick: (repoPath: string, sha: string) => Promise<{ conflicts: string[] }>
    revert: (repoPath: string, sha: string) => Promise<{ conflicts: string[] }>
    /** The cherry-pick or revert that stopped part way, or null. */
    sequencerOp: (repoPath: string) => Promise<SequencerOp | null>
    sequencerStep: (repoPath: string, step: SequencerStep) => Promise<{ conflicts: string[] }>
    /** Commits on the current branch after `sha`. */
    commitsAfter: (repoPath: string, sha: string) => Promise<number>
    reset: (repoPath: string, sha: string, mode: ResetMode) => Promise<void>
    createTag: (repoPath: string, name: string, sha: string, message?: string) => Promise<void>
    deleteTag: (repoPath: string, name: string) => Promise<void>
    pushTag: (request: TagPushRequest) => Promise<RemoteOpResult>
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
    /** `baseUrl`: address of a self-managed GitLab instance; omit for GitLab.com and the other hosts. */
    saveToken: (
      provider: ProviderId,
      token: string,
      username?: string,
      baseUrl?: string
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
    /** Show a repository file in Explorer / Finder / the file manager. */
    showInFolder: (repoPath: string, path: string) => Promise<void>
  }
}

declare global {
  interface Window {
    gitManager: GitManagerApi
  }
}

export {}
