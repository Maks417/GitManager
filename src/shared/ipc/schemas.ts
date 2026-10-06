import { z } from 'zod'
import { PROVIDER_IDS } from '../providers'
import { SHA_RE } from '../sha'
import { HISTORY_PAGE_SIZE, LAYOUT_DEFAULTS } from '../layout-defaults'

export const RepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  currentBranch: z.string().nullable(),
  remotes: z.array(
    z.object({
      name: z.string(),
      url: z.string()
    })
  ),
  /**
   * For a linked worktree, the main work tree of the repository it belongs to. Remembered so the worktree's
   * record can still be removed from that repository after the worktree folder is gone.
   */
  worktreeOf: z.string().nullable().optional()
})
export type Repository = z.infer<typeof RepositorySchema>

/** What deleting a repository folder would lose. */
export const RepoRemovalInfoSchema = z.object({
  uncommitted: z.number().int().nonnegative(),
  stashes: z.number().int().nonnegative(),
  /** Commits on local branches that no remote-tracking branch contains. */
  unpushed: z.number().int().nonnegative()
})
export type RepoRemovalInfo = z.infer<typeof RepoRemovalInfoSchema>

/** How a repository in the list relates to Git worktrees, for removing it. */
export const WorktreeInfoSchema = z.object({
  /** Whether the repository folder still exists. */
  exists: z.boolean(),
  /** For a linked worktree: its main work tree, whether that still exists, and whether Git keeps it locked. */
  linkedTo: z
    .object({
      mainPath: z.string(),
      mainExists: z.boolean(),
      locked: z.boolean()
    })
    .nullable(),
  /** Linked worktrees that use this repository's history; they stop working once its folder is deleted. */
  otherWorktrees: z.number().int().nonnegative()
})
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>

export const RepoRemoveOptionsSchema = z.object({
  /** Move the repository folder to the Trash. */
  deleteFiles: z.boolean().optional(),
  /** For a linked worktree whose folder is gone: remove its record from the main repository too. */
  pruneWorktree: z.boolean().optional()
})
export type RepoRemoveOptions = z.infer<typeof RepoRemoveOptionsSchema>

export const RepoRemoveResultSchema = z.object({
  /** Set when the repository left the list but Git kept its worktree record. */
  warning: z.string().nullable()
})
export type RepoRemoveResult = z.infer<typeof RepoRemoveResultSchema>

export const CommitRefSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'remote', 'tag', 'head']),
  color: z.string().optional()
})
export type CommitRef = z.infer<typeof CommitRefSchema>

export const CommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  body: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.string(),
  parents: z.array(z.string()),
  refs: z.array(CommitRefSchema)
})
export type Commit = z.infer<typeof CommitSchema>

export const GraphNodeSchema = z.object({
  sha: z.string(),
  /** Lane of the commit dot. */
  lane: z.number(),
  /** Every lane index drawn in this row (used for column sizing). */
  lanes: z.array(z.number()),
  /** Lanes that run straight through the row without touching the commit. */
  passThrough: z.array(z.number()),
  /** Other lanes that end at this commit from above (branches meeting their fork point). */
  joins: z.array(z.number()),
  /** A line reaches the dot from above in its own lane (false for branch tips). */
  hasIncoming: z.boolean(),
  /** Lines leaving the dot downwards, one per parent. */
  connections: z.array(
    z.object({
      fromLane: z.number(),
      toLane: z.number(),
      type: z.enum(['parent', 'merge'])
    })
  )
})
export type GraphNode = z.infer<typeof GraphNodeSchema>

export const HistoryPageSchema = z.object({
  commits: z.array(CommitSchema),
  graph: z.array(GraphNodeSchema),
  nextCursor: z.string().nullable(),
  headSha: z.string().nullable(),
  /** Branches a `branch:` search selected (short names); absent without one. */
  branches: z.array(z.string()).optional(),
  /** Why the page is empty when that needs saying, e.g. no branch matches the search. */
  notice: z.string().optional(),
  /** Answer to `HistoryQuery.revealSha`: when found, the page runs one page past that commit. */
  revealed: z.boolean().optional()
})
export type HistoryPage = z.infer<typeof HistoryPageSchema>

export const FileChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'unmerged', 'typechange']),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  oldPath: z.string().optional()
})
export type FileChange = z.infer<typeof FileChangeSchema>

/** A commit in the history of one file, with the path the file had in it. */
export const FileHistoryEntrySchema = CommitSchema.extend({
  path: z.string(),
  status: FileChangeSchema.shape.status,
  /** Where the file came from when this commit renamed or copied it. */
  oldPath: z.string().optional()
})
export type FileHistoryEntry = z.infer<typeof FileHistoryEntrySchema>

export const FileHistoryPageSchema = z.object({
  entries: z.array(FileHistoryEntrySchema),
  hasMore: z.boolean()
})
export type FileHistoryPage = z.infer<typeof FileHistoryPageSchema>

export const BlameCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  author: z.string(),
  authoredAt: z.string(),
  summary: z.string(),
  /** Lines changed in the work tree and not committed yet. */
  uncommitted: z.boolean(),
  /** The commit before this one that touched the file, and the file's path there: "blame before this change". */
  previousSha: z.string().optional(),
  previousPath: z.string().optional()
})
export type BlameCommit = z.infer<typeof BlameCommitSchema>

export const BlameResultSchema = z.object({
  path: z.string(),
  /** The commit blamed at, or null for the work tree. */
  rev: z.string().nullable(),
  text: z.string(),
  /** Runs of consecutive lines (1-based) last changed by the same commit. */
  groups: z.array(z.object({ sha: z.string(), startLine: z.number(), lineCount: z.number() })),
  commits: z.record(z.string(), BlameCommitSchema)
})
export type BlameResult = z.infer<typeof BlameResultSchema>

export const CommitDetailSchema = z.object({
  commit: CommitSchema,
  files: z.array(FileChangeSchema)
})
export type CommitDetail = z.infer<typeof CommitDetailSchema>

export const DiffRequestSchema = z.object({
  repoPath: z.string().min(1),
  sha: z.string().regex(SHA_RE, 'Invalid commit id'),
  path: z.string().min(1),
  /** Pre-rename path, so the parent side of a renamed file can be read. */
  oldPath: z.string().min(1).optional(),
  parentIndex: z.number().int().min(0).default(0)
})
export type DiffRequest = z.infer<typeof DiffRequestSchema>

export const WorkingTreeDiffRequestSchema = z.object({
  repoPath: z.string(),
  path: z.string(),
  side: z.enum(['staged', 'unstaged'])
})
export type WorkingTreeDiffRequest = z.infer<typeof WorkingTreeDiffRequestSchema>

export const ImageSideSchema = z.object({
  /** `data:` URL of the image; null when the file is over the preview size limit. */
  dataUrl: z.string().nullable(),
  bytes: z.number()
})
export type ImageSide = z.infer<typeof ImageSideSchema>

/** Both versions of an image file; a side is null when the file does not exist there (added or deleted). */
export const ImagePreviewSchema = z.object({
  old: ImageSideSchema.nullable(),
  new: ImageSideSchema.nullable()
})
export type ImagePreview = z.infer<typeof ImagePreviewSchema>

export const DiffHunkSchema = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  /** Line numbers of each line: context lines have both, removed lines only old, added lines only new. */
  lines: z.array(
    z.object({
      kind: z.enum(['context', 'add', 'del']),
      oldLine: z.number().nullable(),
      newLine: z.number().nullable()
    })
  )
})
export type DiffHunk = z.infer<typeof DiffHunkSchema>

/** Hunks of a work-tree diff that can be staged one by one; `fingerprint` identifies the diff they come from. */
export const HunkSetSchema = z.object({
  fingerprint: z.string(),
  hunks: z.array(DiffHunkSchema)
})
export type HunkSet = z.infer<typeof HunkSetSchema>

export const DiffResultSchema = z.object({
  path: z.string(),
  oldText: z.string(),
  newText: z.string(),
  binary: z.boolean(),
  /** Set for image files (by extension), next to the text diff. */
  image: ImagePreviewSchema.optional(),
  /** Work-tree diffs only: set when single hunks or lines can be staged, unstaged or discarded. */
  hunks: HunkSetSchema.optional()
})
export type DiffResult = z.infer<typeof DiffResultSchema>

const LineNumbersSchema = z.array(z.number().int().min(1)).max(1_000_000)

export const ApplyPartialRequestSchema = z.object({
  repoPath: z.string(),
  path: z.string().min(1),
  side: z.enum(['staged', 'unstaged']),
  /** Stage and discard work on unstaged changes, unstage on staged ones. */
  action: z.enum(['stage', 'unstage', 'discard']),
  fingerprint: z.string().min(1),
  /** One hunk by index, or changed lines: removed lines by old line number, added lines by new line number. */
  selection: z.union([
    z.object({ hunk: z.number().int().min(0) }),
    z.object({ oldLines: LineNumbersSchema, newLines: LineNumbersSchema })
  ])
})
export type ApplyPartialRequest = z.infer<typeof ApplyPartialRequestSchema>
export type PartialSelection = ApplyPartialRequest['selection']
export type PartialAction = ApplyPartialRequest['action']

export const StatusEntrySchema = z.object({
  path: z.string(),
  indexStatus: z.string(),
  workTreeStatus: z.string(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  conflicted: z.boolean(),
  /** Where a renamed or copied path came from. */
  oldPath: z.string().optional()
})
export type StatusEntry = z.infer<typeof StatusEntrySchema>

export const BranchInfoSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  /** Tip commit; null for a branch that has no commits yet. */
  sha: z.string().nullable()
})
export type BranchInfo = z.infer<typeof BranchInfoSchema>

export const RemoteConfigSchema = z.object({
  name: z.string(),
  fetchUrl: z.string(),
  pushUrl: z.string()
})
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>

export const SaveRemoteRequestSchema = z.object({
  repoPath: z.string().min(1),
  name: z.string().trim().min(1),
  url: z.string().trim().min(1),
  pushUrl: z.string().trim().optional(),
  create: z.boolean()
})
export type SaveRemoteRequest = z.infer<typeof SaveRemoteRequestSchema>

export const SetUpstreamRequestSchema = z.object({
  repoPath: z.string().min(1),
  branch: z.string().min(1),
  upstream: z.string().min(1).nullable()
})
export type SetUpstreamRequest = z.infer<typeof SetUpstreamRequestSchema>

export const CompareRequestSchema = z.object({
  repoPath: z.string().min(1),
  base: z.string().trim().min(1),
  target: z.string().trim().min(1),
  mergeBase: z.boolean().default(true)
})
export type CompareRequest = z.input<typeof CompareRequestSchema>

export const ComparisonSchema = z.object({
  baseSha: z.string(),
  targetSha: z.string(),
  files: z.array(FileChangeSchema),
  additions: z.number(),
  deletions: z.number(),
  binaryFiles: z.number()
})
export type Comparison = z.infer<typeof ComparisonSchema>

export const CompareDiffRequestSchema = z.object({
  repoPath: z.string().min(1),
  baseSha: z.string().regex(SHA_RE),
  targetSha: z.string().regex(SHA_RE),
  path: z.string().min(1),
  oldPath: z.string().min(1).optional()
})
export type CompareDiffRequest = z.infer<typeof CompareDiffRequestSchema>

export const RecoveryEntrySchema = z.object({
  id: z.string(),
  sha: z.string(),
  kind: z.enum(['commit', 'worktree']),
  label: z.string(),
  createdAt: z.string(),
  saved: z.boolean()
})
export type RecoveryEntry = z.infer<typeof RecoveryEntrySchema>

export const RemoteBranchInfoSchema = z.object({
  name: z.string(),
  remote: z.string(),
  shortName: z.string(),
  /** Tip commit. */
  sha: z.string()
})
export type RemoteBranchInfo = z.infer<typeof RemoteBranchInfoSchema>

export const ConflictFileSchema = z.object({
  path: z.string(),
  hasBase: z.boolean(),
  hasOurs: z.boolean(),
  hasTheirs: z.boolean()
})
export type ConflictFile = z.infer<typeof ConflictFileSchema>

/** 1-based lines `start` up to, not including, `end`; an empty range marks lines removed before `start`. */
export const LineRangeSchema = z.object({ start: z.number(), end: z.number() })
export type LineRange = z.infer<typeof LineRangeSchema>

/** A block of lines one side of a merge changed: where it is in that side, and the base lines it replaced. */
export const SideChangeSchema = z.object({ side: LineRangeSchema, base: LineRangeSchema })
export type SideChange = z.infer<typeof SideChangeSchema>

export const MergeSidesSchema = z.object({
  path: z.string(),
  base: z.string(),
  ours: z.string(),
  theirs: z.string(),
  result: z.string(),
  /** Lines of ours and theirs that differ from base; empty without a base or for large files. */
  oursChanges: z.array(SideChangeSchema).default([]),
  theirsChanges: z.array(SideChangeSchema).default([]),
  /** Text panes are empty when a side is binary or too large; resolve by taking a whole side. */
  binary: z.boolean(),
  tooLarge: z.boolean()
})
export type MergeSides = z.infer<typeof MergeSidesSchema>

export const ConflictSideSchema = z.enum(['ours', 'theirs'])
export type ConflictSide = z.infer<typeof ConflictSideSchema>

export const ProviderIdSchema = z.enum(PROVIDER_IDS)

export const ProviderAccountSchema = z.object({
  id: z.string(),
  provider: ProviderIdSchema,
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  /** Where the account lives, as shown: `github.com`, or a self-managed GitLab like `git.example.org/gitlab`. */
  host: z.string(),
  /** HTTPS address of a self-managed GitLab instance; absent for GitLab.com and the other hosts. */
  baseUrl: z.string().optional(),
  /** False when the token could only be stored without OS encryption. */
  secureStorage: z.boolean().optional()
})
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>

export const RemoteRepoSchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  cloneUrlHttps: z.string(),
  cloneUrlSsh: z.string(),
  defaultBranch: z.string(),
  webUrl: z.string()
})
export type RemoteRepo = z.infer<typeof RemoteRepoSchema>

export const UpdateStatusSchema = z.object({
  checking: z.boolean(),
  available: z.boolean(),
  downloaded: z.boolean(),
  version: z.string().nullable(),
  releaseNotes: z.string().nullable(),
  error: z.string().nullable(),
  progress: z.number().nullable()
})
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  architecture: z.string(),
  homepage: z.string().url()
})
export type AppInfo = z.infer<typeof AppInfoSchema>

/** A layout size: out-of-range numbers are clamped, anything else falls back to the default. */
function sizePref(min: number, max: number, fallback: number) {
  return z
    .preprocess(
      (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : v),
      z.number().min(min).max(max)
    )
    .default(fallback)
    .catch(fallback)
}

/**
 * Every field recovers on its own: a hand-edited file, or a value written by an older or newer
 * version, must never keep the app from starting.
 */
export const AppPreferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system').catch('system'),
  detailDock: z.enum(['right', 'bottom']).default('bottom').catch('bottom'),
  /** File diffs: the changes inline in one file, or the old and the new file side by side. */
  diffView: z.enum(['inline', 'side-by-side']).default('inline').catch('inline'),
  /** Syntax colors in file diffs and the merge editor, for files small enough to color. */
  syntaxHighlighting: z.boolean().default(true).catch(true),
  /** Merge editor panes: ours, result and theirs in three columns, or ours and theirs above a full-width result. */
  mergeEditorLayout: z.enum(['columns', 'stacked']).default('columns').catch('columns'),
  historyFilter: z.enum(['all', 'current']).default('all').catch('all'),
  sidebarCollapsed: z.boolean().default(false).catch(false),
  branchesExpanded: z.boolean().default(false).catch(false),
  remoteBranchesExpanded: z.boolean().default(false).catch(false),
  sidebarWidth: sizePref(140, 480, LAYOUT_DEFAULTS.sidebarWidth),
  inspectorHeight: sizePref(180, 900, LAYOUT_DEFAULTS.inspectorHeight),
  detailWidth: sizePref(280, 900, LAYOUT_DEFAULTS.detailWidth),
  inspectorFilesWidth: sizePref(140, 480, LAYOUT_DEFAULTS.inspectorFilesWidth),
  changesFilesWidth: sizePref(200, 560, LAYOUT_DEFAULTS.changesFilesWidth),
  historyGraphColWidth: sizePref(80, 560, LAYOUT_DEFAULTS.historyGraphColWidth),
  historyDateColWidth: sizePref(72, 220, LAYOUT_DEFAULTS.historyDateColWidth),
  historyAuthorColWidth: sizePref(100, 360, LAYOUT_DEFAULTS.historyAuthorColWidth),
  /** Watch the working tree and refresh status when files change (Windows + macOS). */
  liveStatusWatch: z.boolean().default(true).catch(true),
  externalEditor: z.string().nullable().default(null).catch(null),
  externalTerminal: z.string().nullable().default(null).catch(null),
  checkUpdatesOnStart: z.boolean().default(true).catch(true)
})
export type AppPreferences = z.infer<typeof AppPreferencesSchema>

export const RepoWatchEventSchema = z.object({
  repoPath: z.string(),
  kind: z.enum(['worktree', 'git-meta'])
})
export type RepoWatchEvent = z.infer<typeof RepoWatchEventSchema>

/** How the watched repository is kept up to date: watched, or polled when the system refuses more watches. */
export const RepoWatchStateSchema = z.object({
  repoPath: z.string(),
  mode: z.enum(['live', 'polling']),
  /** Why changes are polled instead of watched; null while live. */
  reason: z.string().nullable()
})
export type RepoWatchState = z.infer<typeof RepoWatchStateSchema>

export const HistoryQuerySchema = z.object({
  repoPath: z.string(),
  search: z.string().optional(),
  author: z.string().optional(),
  path: z.string().optional(),
  branch: z
    .string()
    .min(1)
    .refine((b) => !b.startsWith('-'), 'Invalid branch')
    .optional(),
  mergesOnly: z.boolean().optional(),
  /** Commits already shown; the next page starts after them (`git log --skip`). */
  skip: z.number().int().min(0).max(1_000_000).optional(),
  limit: z.number().min(1).max(500).default(HISTORY_PAGE_SIZE),
  /** Load from the top down to this commit and one page past it, instead of a page from `skip`. */
  revealSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, 'Invalid commit id')
    .optional()
})
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>

export const RemoteOpKindSchema = z.enum(['fetch', 'pull', 'push'])
export type RemoteOpKind = z.infer<typeof RemoteOpKindSchema>

/** Chosen by the renderer, which uses it to match progress events and to cancel. */
export const OperationIdSchema = z.string().regex(/^[\w-]{8,64}$/, 'Invalid operation id')

export const RemoteOpRequestSchema = z.object({
  repoPath: z.string().min(1),
  opId: OperationIdSchema,
  /** Push only: overwrite the remote branch, guarded by --force-with-lease. */
  force: z.boolean().optional(),
  /** Explicit publication destination; both fields must be supplied together. */
  remote: z.string().min(1).optional(),
  targetBranch: z.string().min(1).optional(),
  /** Explicit push only: defaults to true for existing callers. */
  setUpstream: z.boolean().optional(),
  /** Explicit push only: refuse if the checked-out branch changed after destination review. */
  expectedBranch: z.string().min(1).optional()
})
export type RemoteOpRequest = z.infer<typeof RemoteOpRequestSchema>

/** Pushes one tag to the default push remote, or deletes it there; progress and cancel work as for a push. */
export const TagPushRequestSchema = RemoteOpRequestSchema.extend({
  tag: z.string().min(1),
  remove: z.boolean().default(false)
})
export type TagPushRequest = z.input<typeof TagPushRequestSchema>

export const ResetModeSchema = z.enum(['soft', 'mixed', 'hard'])
export type ResetMode = z.infer<typeof ResetModeSchema>

/** A cherry-pick or revert that stopped part way; continued, skipped or aborted like a rebase. */
export const SequencerOpSchema = z.enum(['cherry-pick', 'revert'])
export type SequencerOp = z.infer<typeof SequencerOpSchema>
export const SequencerStepSchema = z.enum(['continue', 'skip', 'abort'])
export type SequencerStep = z.infer<typeof SequencerStepSchema>

export const RemoteProgressSchema = z.object({
  /** Git's current step, e.g. "Receiving objects". */
  phase: z.string(),
  percent: z.number().min(0).max(100).nullable(),
  /** False while a pull updates the work tree, which must not be interrupted. */
  cancellable: z.boolean()
})
export type RemoteProgress = z.infer<typeof RemoteProgressSchema>

export const GitProgressSchema = RemoteProgressSchema.extend({
  opId: z.string(),
  /** The repository, or for a clone the folder it clones into. */
  repoPath: z.string(),
  kind: z.enum(['fetch', 'pull', 'push', 'clone'])
})
export type GitProgress = z.infer<typeof GitProgressSchema>

export const RemoteOpResultSchema = z.object({
  /**
   * `rejected`: a push the remote refused because it has commits this branch lacks.
   * `diverged`: a pull that cannot fast-forward because both sides have new commits.
   */
  outcome: z.enum(['done', 'cancelled', 'rejected', 'diverged']),
  /** For `rejected` and `diverged`: the branch. */
  branch: z.string().optional(),
  /** For `diverged`: its upstream, as a full ref name (refs/remotes/origin/main). */
  upstream: z.string().optional()
})
export type RemoteOpResult = z.infer<typeof RemoteOpResultSchema>

export const CloneRequestSchema = z.object({
  url: z.string().min(1),
  /** Parent folder; the clone goes into a sub-folder named after the repository. */
  targetDir: z.string().min(1),
  opId: OperationIdSchema
})
export type CloneRequest = z.infer<typeof CloneRequestSchema>

/** A cancelled clone leaves nothing behind: the partly cloned folder is removed. */
export const CloneResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('done'), repo: RepositorySchema }),
  z.object({ outcome: z.literal('cancelled') })
])
export type CloneResult = z.infer<typeof CloneResultSchema>

export const CreateRepoRequestSchema = z.object({
  /** Existing folder that gets the repository folder. */
  parentDir: z.string().min(1),
  /** Name of the repository folder. */
  name: z.string().min(1),
  initialBranch: z.string().trim().min(1),
  /** Commit a README.md, so the repository starts with a first commit. */
  readme: z.boolean()
})
export type CreateRepoRequest = z.infer<typeof CreateRepoRequestSchema>

export const CreateRepoResultSchema = z.object({
  repo: RepositorySchema,
  /** Set when the repository exists but its first commit failed (usually no Git identity yet). */
  warning: z.string().nullable()
})
export type CreateRepoResult = z.infer<typeof CreateRepoResultSchema>

export const NewRepoTargetRequestSchema = z.object({
  parentDir: z.string(),
  name: z.string()
})
export type NewRepoTargetRequest = z.infer<typeof NewRepoTargetRequestSchema>

/** Where a new repository would be created, checked before anything is written. */
export const NewRepoTargetSchema = z.object({
  path: z.string().nullable(),
  /** Why it cannot be created there; null when it can. */
  problem: z.string().nullable(),
  /** Work tree of an existing repository that would contain the new one. */
  insideRepo: z.string().nullable(),
  /** Git's `init.defaultBranch`, else `main`. */
  defaultBranch: z.string(),
  /** Offered as the location until one is chosen. */
  suggestedParent: z.string()
})
export type NewRepoTarget = z.infer<typeof NewRepoTargetSchema>

export const GitIdentitySchema = z.object({
  name: z.string(),
  email: z.string(),
  /** Where the effective name comes from after Git's normal lookup. */
  nameSource: z.enum(['local', 'global', 'system', 'unset']),
  /** Where the effective email comes from after Git's normal lookup. */
  emailSource: z.enum(['local', 'global', 'system', 'unset'])
})
export type GitIdentity = z.infer<typeof GitIdentitySchema>

/** Live refresh of status only, or of branches/identity/operation flags too. */
export const RepoRefreshScopeSchema = z.enum(['status', 'meta'])
export type RepoRefreshScope = z.infer<typeof RepoRefreshScopeSchema>

export const RepoRefreshRequestSchema = z.object({
  repoPath: z.string().min(1),
  scope: RepoRefreshScopeSchema,
  /** When true, fully inspect the repository (and the main process may persist it). */
  persistRepository: z.boolean().default(false),
  /** Previous repository record; used to keep remotes/worktreeOf without a full inspect. */
  baseRepository: RepositorySchema.optional()
})
export type RepoRefreshRequest = z.infer<typeof RepoRefreshRequestSchema>

export const RepoSessionSnapshotSchema = z.object({
  status: z.array(StatusEntrySchema),
  repository: RepositorySchema.optional(),
  branches: z.array(BranchInfoSchema).optional(),
  remoteBranches: z.array(RemoteBranchInfoSchema).optional(),
  identity: GitIdentitySchema.optional(),
  rebaseInProgress: z.boolean().optional(),
  mergeInProgress: z.boolean().optional(),
  sequencerOp: SequencerOpSchema.nullable().optional(),
  headSha: z.string().nullable().optional(),
  /** Changes when HEAD, refs or in-progress operations change; gates tip history refresh. */
  historyFingerprint: z.string().optional()
})
export type RepoSessionSnapshot = z.infer<typeof RepoSessionSnapshotSchema>

export const GitProbeResultSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  message: z.string().nullable()
})
export type GitProbeResult = z.infer<typeof GitProbeResultSchema>

export const SetGitIdentityRequestSchema = z.object({
  repoPath: z.string().min(1),
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  scope: z.enum(['local', 'global']).default('local')
})
export type SetGitIdentityRequest = z.infer<typeof SetGitIdentityRequestSchema>

export const StashEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  message: z.string(),
  reflogSelector: z.string()
})
export type StashEntry = z.infer<typeof StashEntrySchema>
