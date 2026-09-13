# Git Manager

Cross-platform (Windows / macOS) Git desktop client with a **history-first** UI, host integrations (GitHub, GitLab, Bitbucket), SSH/HTTPS cloning, a VS Code-style merge editor, and signed auto-updates from GitHub Releases.

**Requires** system Git on `PATH` (or set `GIT_MANAGER_GIT_PATH` to a Git binary). The app probes for Git at startup and guides you to install it if missing.

## Stack

- Electron + React + TypeScript (`electron-vite`)
- Real Git CLI (system Git by default; pin/bundle via `GIT_MANAGER_GIT_PATH`)
- Monaco Diff / merge editors
- `electron-builder` + `electron-updater` → public GitHub Releases
- Optional OAuth broker under `services/oauth-broker` for confidential-client flows

## Develop

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
```

## Package

```bash
npm run dist        # current platform
npm run dist:win
npm run dist:mac
```

Publish requires `GH_TOKEN` and platform signing secrets (see `.github/workflows/release.yml`).

## Architecture (short)

- `src/main` — secure Electron main, IPC, updater, menus, secure storage
- `src/preload` — narrow `contextBridge` API
- `src/git-worker` — Git CLI runner + repository operations
- `src/history-core` — topology graph layout / search helpers
- `src/merge-core` — conflict region model
- `src/renderer` — history-first shell (large graph + commit detail diffs)

Opening a repository lands on **History**. The graph uses most of the workspace; selecting a commit shows files and a side-by-side Monaco diff.
