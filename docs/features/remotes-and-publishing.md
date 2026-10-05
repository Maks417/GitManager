# Feature: Remotes & publishing

## Purpose

Connect a local repository to an existing remote repository, choose where to publish its current branch, and manage branch tracking without opening a terminal.

## User flow

1. Open **Repository → Manage Remotes**, or **Remote branches → ⋯ → Manage remotes**. The dialog opens with the configured remote list; **Add remote** and **Edit** reveal a focused form.
2. Enter a name and an existing repository’s HTTPS/SSH URL or local path. **Advanced** contains an optional separate push URL; leaving it empty uses the repository URL. Saving does not fetch. **Remove** asks first, removes the local remote configuration and tracking refs, and keeps the server repository.
3. Use **Sync → Fetch** or the refresh button beside **Remote branches** to load branches.
4. Open a local branch’s **⋯ → Tracking**, or click the current branch’s tracking status. The branch is fixed; select an upstream or **No upstream**, then **Save**. **Fetch remote branches** refreshes the choices. This changes configuration without pushing commits.
5. Push a branch without an upstream using **Sync → Publish branch**, the current-branch summary, **Repository → Push**, or the commit form’s **Push to remote** option. Each opens the same destination review before sending anything. Select a remote and destination branch, then **Publish** to push and establish tracking. A repository without remotes can add one inside this flow.
6. A tracked branch uses **Sync → Push** for its ordinary push. **Sync → Push to** or the current branch’s **⋯ → Push to** reviews another destination. Existing upstream configuration stays unless **Use this destination as upstream** is checked. The final **Push** button executes without another confirmation. Failures keep the draft open; progress and cancellation appear in the dialog and toolbar.

The server repository must already exist. This feature does not create a repository on GitHub, GitLab or Bitbucket. Authentication continues to use the system Git credential helper or SSH agent ([Host accounts](host-accounts.md)).

## Key modules & files

| Piece | File |
|---|---|
| Remote management | [RemotesModal.tsx](../../src/renderer/src/features/remotes/RemotesModal.tsx) |
| Destination review | [PublishBranchModal.tsx](../../src/renderer/src/features/remotes/PublishBranchModal.tsx) |
| Branch tracking | [BranchTrackingModal.tsx](../../src/renderer/src/features/branches/BranchTrackingModal.tsx) |
| Remote configuration | [remotes.ts](../../src/git-worker/ops/remotes.ts) |
| Explicit publication | [branches.ts](../../src/git-worker/ops/branches.ts) (`publishBranch`) |
| Progress and cancellation | [remote-ops.ts](../../src/main/remote-ops.ts) |

## Data touched

- Git remote URLs, fetch refspecs and optional push URL.
- Local branch upstream configuration and remote-tracking refs.
- Remote branch commits when publishing.

## Edge cases & rules

- Remote names start with a letter or number and use letters, numbers, dots, underscores and hyphens. Duplicate remote names and missing edited remotes are rejected.
- Clearing the push URL removes all explicit push URL overrides for that remote.
- Tracking can only be set to an existing local remote-tracking branch; fetch first.
- Publication accepts a valid destination branch and requires a checked-out local branch with a commit. A changed checkout invalidates the review; the worker checks the expected source branch before pushing. Explicit pushes do not force push.
- First publication defaults to `origin`, otherwise the sole remote; several remotes without `origin` require a selection. The default destination is the local branch name. **Push to** initially shows the existing upstream destination.
- The explicit push request’s optional `setUpstream` defaults to true for existing callers. The destination review sends the checkbox choice explicitly. Success refers to the chosen destination, even when the retained upstream still lacks local commits.
- The current branch’s upstream or **No upstream** is always visible, even with no ahead/behind difference. Branch overflow menus also work with right-click and Shift+F10; history shortcuts remain visible.
