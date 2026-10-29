# Feature: Worktrees

## Purpose

Work on several branches at once, each in a folder of its own (`git worktree`). Every worktree shares the repository's history, branches and stashes. Git checks a branch out in only one worktree at a time.

## User flow

1. The **Worktrees** section of the sidebar (collapsed by default, `AppPreferences.worktreesExpanded`) lists the repository's work trees. The main work tree comes first. Each row shows its folder name and its branch, or "detached at abc1234", plus marks for the main worktree, locked (with the reason on hover) and missing. The worktree that is open is highlighted.
2. Double-click a row, or press Enter on it, to open that worktree. It joins the Repositories list, nested under its main repository, and becomes the active repository.
3. **+**, Repository → **New Worktree…**, **Check out in new worktree…** on a local or remote branch, and **New worktree here…** on a commit in History all open **New worktree**:
   - **Existing branch**: one not checked out anywhere. Branches checked out here or in another worktree are listed but disabled.
   - **New branch**, starting at HEAD, a branch or a remote branch. A new branch started from a remote branch tracks it. Opened from a remote branch, the dialog proposes a branch of the same name, or picks the existing local one.
   - **Commit**, when opened from History: the worktree checks it out detached.
   - **Folder** defaults to a sibling of the main work tree named `<repository>-<branch>`, with `/` turned into `-`. **Browse…** picks the folder it goes in, and the folder field can be edited. The folder must not exist yet, or must be empty.
   - **Open the worktree after creating it** is on by default.
4. A row's menu (right-click, Shift+F10 or the context-menu key) has **Open**, **Open folder**, **Lock** / **Unlock** and **Remove worktree…**. Remove deletes the folder after confirming. When the worktree has uncommitted or untracked files, a second confirmation offers **Remove anyway**. A removed worktree also leaves the Repositories list. The main work tree, the open worktree and a locked worktree cannot be removed.
5. The section's **…** menu has **Prune missing worktrees** (`git worktree prune`), which drops the records of every worktree whose folder is gone.

## Branches in other worktrees

- A local branch that another worktree has checked out shows a worktree mark. Hovering it shows that worktree's folder (`BranchInfo.worktreePath`, from `for-each-ref %(worktreepath)`). This needs Git 2.23 or newer, the app's minimum: with an older Git the app shows a banner at startup, and branches get no mark.
- Its menu offers **Open its worktree** instead of **Check out**, and **Delete branch** is disabled.
- Checking it out anyway (double-click, Enter, or a remote branch whose local branch is held) asks whether to open that worktree instead of showing Git's error. A delete that Git refuses for the same reason explains it and offers no force delete, which would fail too.
- A checkout in a sibling worktree rewrites `.git/worktrees/<id>/HEAD`. The watcher reports that as a meta change, so the marks follow. Its index and logs stay ignored.

## Key modules & files

| Piece | File |
|---|---|
| List, add, remove, lock, prune | [`worktrees.ts`](../../src/git-worker/ops/worktrees.ts) |
| Worktree marks on branches | [`branches.ts`](../../src/git-worker/ops/branches.ts) (`readRefs`) |
| Sidebar section | [`WorktreesSection.tsx`](../../src/renderer/src/shell/WorktreesSection.tsx) |
| Dialog | [`CreateWorktreeModal.tsx`](../../src/renderer/src/features/worktrees/CreateWorktreeModal.tsx) |
| Default folder, repository nesting | [`worktree-paths.ts`](../../src/renderer/src/logic/worktree-paths.ts) |
| Opening, checkout offer | [`GitActionsProvider.tsx`](../../src/renderer/src/state/GitActionsProvider.tsx) (`openWorktree`, `checkoutBranch`) |

## Edge cases & rules

- Worktree operations queue on the repository's common Git directory, so actions in two worktrees of one repository never run at once.
- Folders, branches and start points are checked before reaching Git: the folder must be absolute, and refs must not look like options. Lock, unlock and remove only act on a worktree Git lists for the repository, and never on its main work tree. **Open folder** only opens a folder Git lists as a worktree.
- Git for Windows reports worktree folders as `C:/x/y`; the app shows and stores them as `C:\x\y`.
- Removing a worktree from the Repositories list alone (the trash icon there) works as described in [Repository management](repository-management.md).
