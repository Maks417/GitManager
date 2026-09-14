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
  )
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
  headSha: z.string().nullable()
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

export const DiffResultSchema = z.object({
  path: z.string(),
  oldText: z.string(),
  newText: z.string(),
  binary: z.boolean(),
  language: z.string().optional()
})
export type DiffResult = z.infer<typeof DiffResultSchema>

export const StatusEntrySchema = z.object({
  path: z.string(),
  indexStatus: z.string(),
  workTreeStatus: z.string(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  conflicted: z.boolean()
})
export type StatusEntry = z.infer<typeof StatusEntrySchema>

export const BranchInfoSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number()
})
export type BranchInfo = z.infer<typeof BranchInfoSchema>

export const RemoteBranchInfoSchema = z.object({
  name: z.string(),
  remote: z.string(),
  shortName: z.string()
})
export type RemoteBranchInfo = z.infer<typeof RemoteBranchInfoSchema>

export const ConflictFileSchema = z.object({
  path: z.string(),
  hasBase: z.boolean(),
  hasOurs: z.boolean(),
  hasTheirs: z.boolean()
})
export type ConflictFile = z.infer<typeof ConflictFileSchema>

export const MergeSidesSchema = z.object({
  path: z.string(),
  base: z.string(),
  ours: z.string(),
  theirs: z.string(),
  result: z.string(),
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
  host: z.string(),
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
  /** Prefer `normal` for large trees; `all` lists every untracked path recursively. */
  statusUntracked: z.enum(['normal', 'all']).default('normal').catch('normal'),
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
  limit: z.number().min(1).max(500).default(HISTORY_PAGE_SIZE)
})
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>

export const CloneRequestSchema = z.object({
  url: z.string().min(1),
  /** Parent folder; the clone goes into a sub-folder named after the repository. */
  targetDir: z.string().min(1)
})
export type CloneRequest = z.infer<typeof CloneRequestSchema>

export const GitIdentitySchema = z.object({
  name: z.string(),
  email: z.string(),
  /** Where the effective name comes from after Git's normal lookup. */
  nameSource: z.enum(['local', 'global', 'system', 'unset']),
  /** Where the effective email comes from after Git's normal lookup. */
  emailSource: z.enum(['local', 'global', 'system', 'unset'])
})
export type GitIdentity = z.infer<typeof GitIdentitySchema>

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
