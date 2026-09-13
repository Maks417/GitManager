<p align="center">
  <img src="build/icon.svg" alt="Git Manager" width="96" height="96" />
</p>

<h1 align="center">Git Manager</h1>

<p align="center">
  Cross-platform Git desktop client with a history-first UI,<br />
  host integrations, merge editor, and signed auto-updates.
</p>

<p align="center">
  <a href="https://github.com/Maks417/GitManager/actions/workflows/ci.yml"><img src="https://github.com/Maks417/GitManager/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Maks417/GitManager/releases"><img src="https://img.shields.io/github/v/release/Maks417/GitManager?include_prereleases&label=release" alt="Release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-12110F?labelColor=1C1A17" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-E85D04?labelColor=1C1A17" alt="License" /></a>
</p>

---

## Screenshots

Add PNGs under [`docs/assets/`](docs/assets/), then uncomment the images below:

| File | Shows |
|---|---|
| `history.png` | History graph view |
| `changes.png` | Working tree and changes |
| `merge.png` | Merge conflict editor |

<!--
<p align="center">
  <img src="docs/assets/history.png" alt="History graph view" width="800" />
</p>

<p align="center">
  <img src="docs/assets/changes.png" alt="Working tree and changes" width="800" />
</p>

<p align="center">
  <img src="docs/assets/merge.png" alt="Merge conflict editor" width="800" />
</p>
-->

## Features

| | |
|---|---|
| **History-first graph** | Large commit topology with search, branch filter, and side-by-side diffs |
| **Working tree** | Stage, unstage, discard, and commit with a clear Changes view |
| **Branches & sync** | Create/switch branches, fetch, pull, push against remotes |
| **Merge editor** | VS Code–style conflict resolution with Monaco |
| **Host accounts** | GitHub, GitLab, and Bitbucket for browsing and cloning |
| **Clone** | HTTPS or SSH from URL or linked host listings |
| **Auto-updates** | Signed updates from [GitHub Releases](https://github.com/Maks417/GitManager/releases) |

## Requirements

- **Windows** or **macOS**
- **System Git** on `PATH`, or set `GIT_MANAGER_GIT_PATH` to a Git binary

The app probes for Git at startup and guides you to install it if missing.

## Install

Download the latest build from **[Releases](https://github.com/Maks417/GitManager/releases)**.

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

Publishing uses [`.github/workflows/release.yml`](.github/workflows/release.yml) (`GH_TOKEN` and platform signing secrets).

## Architecture

| Layer | Role |
|---|---|
| `src/main` | Electron main — IPC, menus, secure storage, updater |
| `src/preload` | Narrow `contextBridge` API (`window.gitManager`) |
| `src/git-worker` | Git CLI runner and repository operations |
| `src/history-core` | Commit-graph layout and search helpers |
| `src/merge-core` | Conflict region model |
| `src/renderer` | History-first React UI |

Opening a repository lands on **History**. The graph uses most of the workspace; selecting a commit shows files and a side-by-side Monaco diff.

Full write-up: [`docs/architecture.md`](docs/architecture.md).

## Documentation

| Doc | What's inside |
|---|---|
| [Docs index](docs/index.md) | Entry point for all project docs |
| [Architecture](docs/architecture.md) | Components, data flow, diagrams |
| [Domain model](docs/domain-model.md) | Entities and invariants |
| [Brandbook](docs/brandbook.md) | Ink & Ember design system |
| [Repository management](docs/features/repository-management.md) | Open, create, clone |
| [History graph](docs/features/history-graph.md) | Topology UI |
| [Working tree](docs/features/working-tree.md) | Changes & commits |
| [Branches & sync](docs/features/branches-and-sync.md) | Branch ops and remotes |
| [Merge editor](docs/features/merge-editor.md) | Conflict resolution |
| [Host accounts](docs/features/host-accounts.md) | GitHub / GitLab / Bitbucket |
| [Auto-updates](docs/features/auto-updates.md) | Release updates |

## License

[MIT](LICENSE) © Maks417
