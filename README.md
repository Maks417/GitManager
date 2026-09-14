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

## Features

| | |
|---|---|
| **History-first graph** | Large commit topology with search, branch filter, and side-by-side diffs |
| **Working tree** | Stage, unstage, discard, and commit with a clear Changes view |
| **Branches & sync** | Create/switch branches, fetch, pull, push against remotes |
| **Merge editor** | VS Code–style conflict resolution with Monaco |
| **Host accounts** | GitHub, GitLab (including self-managed instances), and Bitbucket for browsing and cloning |
| **New repository** | Create a repository with its initial branch and a first README commit |
| **Clone** | HTTPS or SSH from URL or linked host listings, with progress and cancel |
| **Auto-updates** | Signed updates from [GitHub Releases](https://github.com/Maks417/GitManager/releases) |

## Requirements

- **Windows** or **macOS**
- **System Git** on `PATH`, or set `GIT_MANAGER_GIT_PATH` to a Git binary

The app probes for Git at startup and guides you to install it if missing.

## Install

Download the latest build from **[Releases](https://github.com/Maks417/GitManager/releases)**.

## Connect host accounts

Use **Host accounts** from the welcome screen, or **Accounts** in the app menu, to link GitHub, GitLab (GitLab.com or your own instance), or Bitbucket. The app stores the token in OS secure storage and lists remote repos so you can clone them (HTTPS or SSH).

1. Open **Host accounts**.
2. Choose a provider.
3. Paste a personal access token (for a self-managed GitLab, also enter its address; for Bitbucket: an Atlassian API token plus your Atlassian account email).
4. Click **Connect**.
5. Select an account in the list to load remote repositories, then **Clone** a repo.

| Provider | Credential | Notes |
|---|---|---|
| **GitHub** | [Personal access token](https://github.com/settings/tokens) | Classic or fine-grained. Needs permission to read your profile and list repositories (private repos need repo access). |
| **GitLab** | [Personal access token](https://gitlab.com/-/user_settings/personal_access_tokens) | Needs API access to read your user and projects (e.g. `read_api`). For a self-managed instance, create the token there and enter the instance's HTTPS address, e.g. `https://gitlab.example.com`; leave the address empty for `gitlab.com`. |
| **Bitbucket** | [API token](https://id.atlassian.com/manage-profile/security/api-tokens) | Enter your Atlassian account **email** plus the API token (Bitbucket app passwords were retired). Needs read access to your account and repositories. |

Clone, fetch, and push still use your normal Git credentials: **HTTPS** via Git Credential Manager, **SSH** via your OpenSSH agent and keys. Connecting an account only unlocks browsing and one-click clone from the host listing.

More detail: [`docs/features/host-accounts.md`](docs/features/host-accounts.md).

## Search history

Type in the search box above the history and press Enter. Search runs in Git across all branches, unless you narrow it:

| Search | Finds |
|---|---|
| `fix login` | Commits whose message contains the text, ignoring case |
| `author:Ada` | Commits by that author |
| `3f2c1ab` | That commit (7–40 hex digits) |
| `branch:main` | The history of `main`, together with remote-tracking copies such as `origin/main` |
| `branch:feature/*` | The history of every branch the pattern matches (`*` and `?` are wildcards) |
| `branch:main fix` | A branch filter combined with a message search |

While you type, matching branches are suggested: ↑/↓ to pick one, Enter to show that branch, Alt+Enter (Option+Enter on macOS) to jump to its tip. Each branch in the sidebar also has **Show only this branch** and **Jump to tip**.

More detail: [`docs/features/history-graph.md`](docs/features/history-graph.md).

## Keyboard

| Key | Does |
|---|---|
| F6 / Shift+F6 | Move between the sidebar, history or changes, the inspector, and the search box |
| ↑ / ↓, PageUp / PageDown, Home / End | Move through commits, changed files, repositories and branches |
| Enter | Commit list: go to the commit's files. Sidebar: open the repository or check out the branch |
| Escape | Commit files: back to the commit list. Menus and suggestions: close them |
| Space | Changes: check or uncheck the file |
| Tab | Leave a read-only diff |
| Arrow keys on a divider or column edge | Resize it (Shift: bigger steps; Home / End: smallest / largest) |

## Develop

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
npm run lint
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
| [Repository management](docs/features/repository-management.md) | Open, create, clone, remove |
| [History graph](docs/features/history-graph.md) | Topology UI |
| [Working tree](docs/features/working-tree.md) | Changes & commits |
| [Branches & sync](docs/features/branches-and-sync.md) | Branch ops and remotes |
| [Merge editor](docs/features/merge-editor.md) | Conflict resolution |
| [Host accounts](docs/features/host-accounts.md) | GitHub / GitLab / Bitbucket |
| [Auto-updates](docs/features/auto-updates.md) | Release updates |

## License

[MIT](LICENSE)
