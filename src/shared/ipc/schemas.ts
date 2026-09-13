import { z } from 'zod'

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
  lane: z.number(),
  lanes: z.array(z.number()),
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
  repoPath: z.string(),
  sha: z.string(),
  path: z.string(),
  parentIndex: z.number().default(0)
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
  result: z.string()
})
export type MergeSides = z.infer<typeof MergeSidesSchema>

export const ProviderAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(['github', 'gitlab', 'bitbucket']),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  host: z.string()
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

export const AppPreferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  detailDock: z.enum(['right', 'bottom']).default('bottom'),
  historyFilter: z.enum(['all', 'current']).default('all'),
  sidebarCollapsed: z.boolean().default(false),
  branchesExpanded: z.boolean().default(false),
  sidebarWidth: z.number().min(140).max(480).default(200),
  inspectorHeight: z.number().min(180).max(900).default(320),
  detailWidth: z.number().min(280).max(900).default(480),
  inspectorFilesWidth: z.number().min(140).max(480).default(200),
  changesFilesWidth: z.number().min(200).max(560).default(300),
  historyGraphColWidth: z.number().min(80).max(560).default(140),
  historyDateColWidth: z.number().min(72).max(220).default(110),
  historyAuthorColWidth: z.number().min(100).max(360).default(180),
  externalEditor: z.string().nullable().default(null),
  externalTerminal: z.string().nullable().default(null),
  checkUpdatesOnStart: z.boolean().default(true)
})
export type AppPreferences = z.infer<typeof AppPreferencesSchema>

export const HistoryQuerySchema = z.object({
  repoPath: z.string(),
  search: z.string().optional(),
  author: z.string().optional(),
  path: z.string().optional(),
  branch: z.string().optional(),
  mergesOnly: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(500).default(200)
})
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>

export const CloneRequestSchema = z.object({
  url: z.string().min(1),
  targetDir: z.string().min(1),
  transport: z.enum(['https', 'ssh']).default('https')
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

export const ConflictPathsResultSchema = z.object({
  conflicts: z.array(z.string())
})
export type ConflictPathsResult = z.infer<typeof ConflictPathsResultSchema>
