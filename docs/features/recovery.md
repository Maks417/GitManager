# Feature: Recovery

## Purpose

Recover previous commits and tracked edits after Git operations performed in the app. Saved backups keep their Git objects reachable until explicitly removed.

## User flow

1. Open **Recovery…** above History or **Repository → Recovery…**.
2. For a **Saved commit** or **HEAD history** entry, use **Create branch…** to keep that commit. Checkout is off by default. **Show commit** opens it in History, including commits no current branch reaches.
3. For a **Tracked-file backup**, commit or stash all current changes, including untracked files, then use **Restore changes**. Confirm to apply the saved index and working-tree changes to the current branch.
4. The backup remains after restoration. **Remove** explicitly deletes a saved backup after confirmation. **Refresh** reloads history and backups.

## Automatic backups

| Operation in the app | Backup |
|---|---|
| Amend | Previous HEAD commit |
| Reset (soft, mixed or hard) | Previous HEAD commit |
| Hard reset | Tracked index and working-tree changes, when present |
| Rebase | Previous HEAD commit |
| Delete branch | That branch's tip commit |
| Discard tracked files, hunks or lines | Tracked index and working-tree changes, when present |

Snapshots capture all tracked changes in the repository, including staged changes, rather than only selected discard paths. Untracked files discarded from Changes go to the OS Trash. They are not part of tracked-file snapshots.

## Key modules & files

| Piece | File |
|---|---|
| Dialog | [RecoveryModal.tsx](../../src/renderer/src/features/recovery/RecoveryModal.tsx) |
| Backups, reflog and restoration | [recovery.ts](../../src/git-worker/ops/recovery.ts) |
| Operation hooks | [status.ts](../../src/git-worker/ops/status.ts), [commits.ts](../../src/git-worker/ops/commits.ts), [branches.ts](../../src/git-worker/ops/branches.ts), [patch.ts](../../src/git-worker/ops/patch.ts) |

## Data touched

- Saved refs under `refs/git-manager/recovery/`, with a reflog label for the operation.
- Git objects created by `stash create`, without changing the user's stash list, index or working tree.
  With unresolved conflicts, a private temporary index and `commit-tree` save the file content and ordinary staged entries instead. The real index and conflicted files stay untouched.
- Up to 50 newest saved backups and 100 recent entries in the current worktree's HEAD reflog.

## Edge cases & rules

- Saved refs are excluded from normal all-branches History and branch decorations; inspect them by commit id through Recovery. Backups are local and normal branch pushes do not publish them.
- Saved refs/objects are shared by linked worktrees. Removing a linked worktree keeps them in the common Git directory. Removing the main repository folder moves that directory and its backups to the Trash too.
- Restoration requires a clean working tree/index and no merge, rebase, cherry-pick or revert in progress. A different branch may cause apply conflicts; normal conflict handling is then available. The snapshot is kept even when apply fails.
- Snapshots made during conflicts preserve the conflicted files' current content, including markers, but not their unresolved index stages or the in-progress operation itself. Those entries are labelled accordingly.
- Tracked snapshots require an existing commit. Before the first commit, tracked discard is refused with guidance to commit first or unstage a new file and discard it to the Trash.
- A failed backup blocks the destructive step. A failed operation may leave a useful backup from before the attempt.
- HEAD reflog entries can expire according to Git configuration. Saved backups remain until removed; removal allows Git garbage collection to reclaim objects no other ref reaches.
- This provides branch recovery and tracked-change restoration, not a general redo stack. Untracked files, edits inside submodules, and operations outside the app are not automatically snapshotted.
