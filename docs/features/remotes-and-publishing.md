# Feature: Remotes & publishing

## Purpose

Connect a local repository to an existing remote repository, choose where to publish its current branch, and manage branch tracking without opening a terminal.

## User flow

1. Open **Repository → Remotes & Publishing…**, or **Sync → Remotes & publishing…**.
2. Add a remote such as `origin` with its HTTPS/SSH URL or a local repository path. A separate push URL is optional; leaving it empty uses the fetch URL.
3. Use **Edit** to change URLs or **Remove** to remove a remote and its local remote-tracking branches. Removal asks first and keeps the server repository.
4. Use **Fetch remotes** in the dialog to load remote branches. Under **Branch tracking**, choose a local branch and upstream; **No upstream** clears tracking.
5. Under **Publish current branch**, choose a remote and destination branch. Confirm **Publish branch** to push and set the upstream. Progress and cancellation are available in the dialog and toolbar.

The server repository must already exist. This feature does not create a repository on GitHub, GitLab or Bitbucket. Authentication continues to use the system Git credential helper or SSH agent ([Host accounts](host-accounts.md)).

## Key modules & files

| Piece | File |
|---|---|
| Dialog | [RemotesModal.tsx](../../src/renderer/src/features/remotes/RemotesModal.tsx) |
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
- Publication accepts a valid destination branch and requires a checked-out local branch. It does not force push.
- Normal Push still uses existing tracking, or chooses `origin`/the sole remote for a branch without tracking. Use this dialog to choose another destination or resolve an ambiguous multi-remote setup.
