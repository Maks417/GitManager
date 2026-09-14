# Feature: Repository management

## Purpose

Keep a list of local repositories the user works with: open existing folders, create new repos, clone from URL or host listings, and remove entries from the app, optionally moving the repository folder to the Trash.

## User flow

1. Empty state or sidebar: **Open**, **Create**, or **Clone**.
2. Open uses a native directory dialog; Create runs `git init` then adds the path; Clone asks for a URL (HTTPS or SSH) and a parent folder.
3. Selecting a repo in the sidebar makes it active — History loads by default (or Changes if there is no HEAD yet).
4. Removing a repo drops it from `repositories.json`. With **Also move the repository folder to the Trash** checked, the dialog first reports uncommitted changes, stashes and unpushed commits (typing the repository name is required when any exist), then moves the folder to the Recycle Bin / Trash — never a permanent delete.

## Key modules & files

| Piece | File |
|---|---|
| App coordinator | [`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx) |
| Welcome / sidebar | [`src/renderer/src/shell/WelcomeScreen.tsx`](../../src/renderer/src/shell/WelcomeScreen.tsx), [`RepoSidebar.tsx`](../../src/renderer/src/shell/RepoSidebar.tsx) |
| Repo session hook | [`src/renderer/src/hooks/useRepoSession.ts`](../../src/renderer/src/hooks/useRepoSession.ts) |
| Clone modal | [`src/renderer/src/features/clone/CloneModal.tsx`](../../src/renderer/src/features/clone/CloneModal.tsx) |
| IPC | [`src/main/ipc/repo-handlers.ts`](../../src/main/ipc/repo-handlers.ts) |
| Inspect / init / clone | [`src/git-worker/ops/repo.ts`](../../src/git-worker/ops/repo.ts) |
| Persistence | [`src/main/storage.ts`](../../src/main/storage.ts) |

## Data touched

- `Repository` list in `repositories.json`
- On-disk `.git` via init/clone
- Optional `RemoteRepo` URLs when cloning from Accounts

## Edge cases & rules

- Invalid or non-Git paths fail at inspect time with an error banner.
- Clone takes any HTTPS or SSH URL ([`CloneRequestSchema`](../../src/shared/ipc/schemas.ts)); the folder is named the way Git would (`…/repo.git/` → `repo`, [`clone-target.ts`](../../src/main/clone-target.ts)). A clone that is stopped after 60 minutes removes its partial folder.
- `pickDirectory` is shared for clone target selection.
- Moving a folder to the Trash is refused for filesystem roots, the home folder or any folder containing it, the app's data and install folders, and anything that is not a Git repository root ([`repo-removal.ts`](../../src/main/repo-removal.ts)). Only git processes running inside that repository are cancelled first.
- Missing system Git: startup calls `git.probe` ([`probeGit`](../../src/git-worker/git-runner.ts)). When unavailable, the welcome screen shows an install banner, **Add** / **Clone** stay disabled, and a button opens https://git-scm.com/downloads. Spawn `ENOENT` (and macOS Xcode CLT stub failures) map to the same install message. Accounts remain usable without the Git CLI.

## Diagram

```mermaid
sequenceDiagram
  actor User
  participant UI as Renderer
  participant Main as Main IPC
  participant Git as git-worker
  User->>UI: Open / Create / Clone
  UI->>Main: repo.openDialog / create / clone
  Main->>Git: inspect / init / clone
  Git-->>Main: Repository
  Main->>Main: saveRepositories
  Main-->>UI: Repository
  UI->>UI: setActiveRepo + loadHistory
```
