# Feature: Branches & sync

## Purpose

Operate on branches and remotes: checkout (local and remote-tracking), create/delete, fetch/pull/push, merge, and rebase (including continue/abort while rebasing).

## User flow

1. Sidebar shows the current branch and expandable local / remote branch lists with ahead/behind.
2. Create branch modal; checkout by clicking a branch; checkout a remote branch via `git:checkout-remote-branch`; delete with optional force confirm.
3. Sync menu: Fetch, Pull, Push.
4. Merge / Rebase open a branch picker; conflicts open the merge editor.
5. While rebasing, Continue / Skip commit / Abort are available from the merge editor and the Changes pane. While merging (`MERGE_HEAD` exists), Abort merge is available in both, and committing from Changes concludes the merge.

## Key modules & files

| Piece | File |
|---|---|
| Shell / actions | [`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx), [`RepoSidebar.tsx`](../../src/renderer/src/shell/RepoSidebar.tsx) |
| Create branch | [`src/renderer/src/features/branches/CreateBranchModal.tsx`](../../src/renderer/src/features/branches/CreateBranchModal.tsx) |
| Branch pick (merge/rebase) | [`src/renderer/src/features/branches/BranchPickModal.tsx`](../../src/renderer/src/features/branches/BranchPickModal.tsx) |
| Branch / sync ops | [`src/git-worker/ops/branches.ts`](../../src/git-worker/ops/branches.ts) |
| Git IPC | [`src/main/ipc/git-handlers.ts`](../../src/main/ipc/git-handlers.ts) |

## Data touched

- Refs and branch tip commits
- Upstream tracking (`BranchInfo.ahead` / `behind`)
- Remote-tracking names (`RemoteBranchInfo`)
- Working tree may gain conflicts from merge/rebase
- Rebase state under `.git` (`isRebaseInProgress`)

## Edge cases & rules

- Soft delete failure can prompt force delete.
- Merge/rebase return `{ conflicts: string[] }`; non-empty list opens merge UI.
- Push/pull/fetch require configured remotes and credentials outside the app (SSH agent / credential helper).
- Push publishes a branch that has no upstream to `origin` (or the only remote) and sets the upstream. A rejected (non-fast-forward) push explains that the remote has newer commits; the app never force-pushes.
- Checkout runs `git checkout <ref> --`, so a name that is not a ref fails instead of restoring same-named files.
- Refs and branch names that look like options (`--exec=…`) are rejected before reaching Git.

## Diagram

```mermaid
sequenceDiagram
  actor User
  participant UI as App
  participant Main as Main IPC
  participant Git as git-worker
  User->>UI: Merge / Rebase / Sync
  UI->>Main: git.merge / rebase / fetch / pull / push
  Main->>Git: operation
  alt conflicts
    Git-->>UI: conflicts[]
    UI->>UI: open MergeEditorModal
  else clean
    Git-->>UI: ok
    UI->>UI: afterGitMutation
  end
```
