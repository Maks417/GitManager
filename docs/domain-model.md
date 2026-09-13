# Domain model

## Entities

| Entity | Description | Key fields |
|---|---|---|
| Repository | Local Git repo tracked by the app | `id`, `name`, `path`, `currentBranch`, `remotes[]` |
| Commit | History entry from `git log` | `sha`, `shortSha`, `subject`, `body`, author, `authoredAt`, `parents[]`, `refs[]` |
| CommitRef | Decoration on a commit | `name`, `type` (`local` \| `remote` \| `tag` \| `head`), optional `color` |
| GraphNode | Layout of one commit in the topology graph | `sha`, `lane`, `lanes[]`, `connections[]` |
| HistoryPage | Paged history payload | `commits`, `graph`, `nextCursor`, `headSha` |
| FileChange | File touched by a commit | `path`, `status`, optional stats / `oldPath` |
| CommitDetail | Commit + changed files | `commit`, `files` |
| DiffResult | Text for Monaco (or binary flag) | `path`, `oldText`, `newText`, `binary`, `language?` |
| StatusEntry | Working-tree / index status line | `path`, index/worktree letters, `staged`, `unstaged`, `untracked`, `conflicted` |
| BranchInfo | Local branch + upstream divergence | `name`, `current`, `upstream`, `ahead`, `behind` |
| StashEntry | Stash reflog entry | `index`, `message`, `reflogSelector` |
| ConflictFile | Path with unmerged stages | `path`, `hasBase`, `hasOurs`, `hasTheirs` |
| MergeSides | Three-way content + working result | `path`, `base`, `ours`, `theirs`, `result` |
| ConflictRegion | Parsed conflict markers (merge-core) | line range, `ours` / `theirs` / `base?`, resolution |
| ProviderAccount | Connected host account (no token in API) | `id`, `provider`, `username`, `displayName`, `host` |
| RemoteRepo | Host repo available to clone | clone URLs, `fullName`, `defaultBranch`, `webUrl` |
| GitIdentity | Effective `user.name` / `user.email` | values + `nameSource` / `emailSource` scopes |
| AppPreferences | UI layout and behavior prefs | theme, dock, column widths, filters, etc. |
| UpdateStatus | Auto-update progress | checking / available / downloaded / version / error / progress |

Schemas: [`src/shared/ipc/schemas.ts`](../src/shared/ipc/schemas.ts). Conflict regions: [`src/merge-core/conflict.ts`](../src/merge-core/conflict.ts).

## Relationships

```mermaid
erDiagram
  Repository ||--o{ BranchInfo : has
  Repository ||--o{ Commit : history
  Repository ||--o{ StatusEntry : workingTree
  Repository ||--o{ StashEntry : stashes
  Repository ||--o| GitIdentity : uses
  Commit ||--o{ CommitRef : decoratedBy
  Commit ||--|| GraphNode : laidOutAs
  Commit ||--o| CommitDetail : expandsTo
  CommitDetail ||--o{ FileChange : includes
  FileChange ||--o| DiffResult : diffsAs
  StatusEntry ||--o| DiffResult : workingTreeDiff
  Repository ||--o{ ConflictFile : mayHave
  ConflictFile ||--|| MergeSides : loads
  MergeSides ||--o{ ConflictRegion : parsesTo
  ProviderAccount ||--o{ RemoteRepo : lists
  RemoteRepo ||--o| Repository : clonesTo
  AppPreferences ||--o| Repository : layoutsUIFor
```

## Persistence

| Store file (`userData/state/`) | Contents |
|---|---|
| `repositories.json` | Saved `Repository[]` |
| `preferences.json` | `AppPreferences` |
| `accounts.json` | Provider accounts + `tokenEnc` (not exposed over IPC list) |

Git objects themselves live on disk under each repository’s `.git`; the app does not mirror the object database.

## Invariants

- A `Repository.path` must be a valid Git work tree before add/create/clone succeeds ([`inspectRepository`](../src/git-worker/operations.ts)).
- IPC list of accounts never returns token material — only metadata ([`ipc.ts`](../src/main/ipc.ts) strips `tokenEnc`).
- History graph lanes are derived from parent topology in log order; they are not persisted ([`layoutCommitGraph`](../src/history-core/layout.ts)).
- `StatusEntry.conflicted` / unmerged paths drive merge-editor open; saving a merge result stages the path.
- Preferences and identity mutations are validated with Zod (`AppPreferencesSchema`, `SetGitIdentityRequestSchema`).
- Effective identity sources follow Git’s local → global → system lookup; unset is explicit when missing.
- Git CLI output may contain secrets; user-facing error strings go through redaction in the runner.
