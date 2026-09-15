import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { isAbsolute, join, normalize, resolve } from 'path'
import { existsSync } from 'fs'
import {
  CloneRequestSchema,
  CreateRepoRequestSchema,
  IpcChannels,
  NewRepoTargetRequestSchema,
  RepoRemoveOptionsSchema,
  type NewRepoTarget,
  type RepoRemoveResult,
  type Repository
} from '@shared/ipc'
import * as git from '../../git-worker/client'
import { cancelGitIn } from '../../git-worker/client'
import { isPathInside } from '../../git-worker/path-utils'
import { loadPreferences, loadRepositories, saveRepositories } from '../storage'
import { getRepoWatchState, getWatchedRepoPath, startRepoWatch, stopRepoWatch } from '../repo-watcher'
import { assertDeletableRepoDir } from '../repo-removal'
import { repoNameFromUrl } from '../clone-target'
import { describeNewRepoTarget } from '../new-repo'
import { runCloneOperation } from '../remote-ops'
import { assertSender } from './assert-sender'
import { upsertRepository } from './repo-store'
import { NonEmptyStringSchema, parseAccountId, parseRepoPath } from './parse'

function storedRepository(rawId: unknown): Repository {
  const id = NonEmptyStringSchema.parse(rawId)
  const repo = loadRepositories().find((r) => r.id === id)
  if (!repo) throw new Error('Repository not found')
  return repo
}

export function registerRepoHandlers(): void {
  ipcMain.handle(IpcChannels.repo.list, async (event) => {
    assertSender(event)
    const stored = loadRepositories()
    const refreshed = []
    for (const entry of stored) {
      try {
        refreshed.push(await git.inspectRepository(entry.path))
      } catch {
        refreshed.push(entry)
      }
    }
    saveRepositories(refreshed)
    return refreshed
  })

  ipcMain.handle(IpcChannels.repo.add, async (event, path: unknown) => {
    assertSender(event)
    const repo = await git.inspectRepository(parseRepoPath(path))
    upsertRepository(repo)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.removalInfo, async (event, rawId: unknown) => {
    assertSender(event)
    const repo = storedRepository(rawId)
    const info = await git.inspectRepoForRemoval(repo.path)
    return { path: resolve(repo.path), ...info }
  })

  ipcMain.handle(IpcChannels.repo.worktreeInfo, async (event, rawId: unknown) => {
    assertSender(event)
    const repo = storedRepository(rawId)
    return git.getWorktreeInfo(repo.path, repo.worktreeOf ?? null)
  })

  ipcMain.handle(IpcChannels.repo.remove, async (event, rawId: unknown, rawOptions?: unknown): Promise<RepoRemoveResult> => {
    assertSender(event)
    const id = NonEmptyStringSchema.parse(rawId)
    const options = RepoRemoveOptionsSchema.optional().parse(rawOptions) ?? {}
    const repos = loadRepositories()
    const repo = repos.find((r) => r.id === id)
    if (!repo) return { warning: null }

    // Asked before the folder goes: afterwards Git can no longer tell which repository it belonged to.
    const mainPath = options.pruneWorktree
      ? (repo.worktreeOf ??
        (await git
          .getWorktreeInfo(repo.path, null)
          .then((info) => info.linkedTo?.mainPath ?? null)
          .catch(() => null)))
      : null

    if (options.deleteFiles && existsSync(repo.path)) {
      const target = assertDeletableRepoDir(repo.path, {
        home: app.getPath('home'),
        protectedPaths: [app.getPath('userData'), app.getAppPath(), process.resourcesPath]
      })

      const watched = getWatchedRepoPath()
      if (watched && isPathInside(target, watched)) stopRepoWatch()
      cancelGitIn(target)
      // Give watchers / git child processes a moment to release handles (esp. Windows).
      await new Promise((r) => setTimeout(r, 150))

      try {
        // Recoverable on purpose: the folder goes to the Recycle Bin / Trash, never a permanent delete.
        await shell.trashItem(target)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `Could not move the folder to the Trash:\n${target}\n\n${msg}\n\nClose other programs using these files and try again, or delete the folder manually.`
        )
      }
    }

    saveRepositories(repos.filter((r) => r.id !== id))
    if (!mainPath) return { warning: null }
    // The repository is off the list either way; a worktree record Git keeps is worth a note, not a failure.
    const warning = await git
      .pruneWorktree(mainPath, repo.path)
      .catch((err: unknown) => `Could not remove the worktree record: ${err instanceof Error ? err.message : String(err)}`)
    return { warning }
  })

  ipcMain.handle(IpcChannels.repo.openDialog, async (event) => {
    assertSender(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const repo = await git.inspectRepository(result.filePaths[0])
    upsertRepository(repo)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.inspectNewRepo, async (event, raw: unknown): Promise<NewRepoTarget> => {
    assertSender(event)
    const request = NewRepoTargetRequestSchema.parse(raw)
    const parentDir = request.parentDir.trim()
    const { path, problem } = describeNewRepoTarget(parentDir, request.name)
    const [defaultBranch, insideRepo] = await Promise.all([
      git.getDefaultBranchName(),
      path && !problem ? git.getEnclosingWorkTree(parentDir) : Promise.resolve(null)
    ])
    return { path, problem, insideRepo, defaultBranch, suggestedParent: app.getPath('documents') }
  })

  ipcMain.handle(IpcChannels.repo.create, async (event, raw: unknown) => {
    assertSender(event)
    const request = CreateRepoRequestSchema.parse(raw)
    // Checked again here: the dialog's last check may be older than the folder's current state.
    const { path, problem } = describeNewRepoTarget(request.parentDir.trim(), request.name)
    if (problem || !path) throw new Error(problem ?? 'Choose where to create the repository.')
    const result = await git.createRepository({
      path,
      name: request.name,
      initialBranch: request.initialBranch,
      readme: request.readme
    })
    upsertRepository(result.repo)
    return result
  })

  ipcMain.handle(IpcChannels.repo.clone, async (event, raw: unknown) => {
    assertSender(event)
    const request = CloneRequestSchema.parse(raw)
    if (!isAbsolute(request.targetDir)) {
      throw new Error('Enter the full path of the parent folder, or choose it with Browse….')
    }
    const target = join(request.targetDir, repoNameFromUrl(request.url))
    const result = await runCloneOperation(event.sender, { opId: request.opId, url: request.url, target })
    if (result.outcome === 'done') upsertRepository(result.repo)
    return result
  })

  ipcMain.handle(IpcChannels.repo.pickDirectory, async (event) => {
    assertSender(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  /** Bumped by every watch / unwatch request, so a slower earlier request never starts a stale watch. */
  let watchRequest = 0

  ipcMain.handle(IpcChannels.repo.watch, async (event, repoPath: unknown) => {
    assertSender(event)
    const path = parseRepoPath(repoPath)
    const request = ++watchRequest
    const prefs = loadPreferences()
    if (prefs.liveStatusWatch === false) {
      stopRepoWatch()
      return null
    }
    // Linked worktrees and submodules keep HEAD, the index and refs outside the work tree.
    const gitDirs = await git.getGitDirs(path).catch(() => undefined)
    if (request !== watchRequest) return getRepoWatchState()
    startRepoWatch(path, {
      ignoreFilter: (root, paths) => git.filterIgnoredPaths(root, paths),
      gitDirs,
      // When the system refuses more watches (Linux's inotify limit), changes are polled instead, and
      // only while one of the app's windows is focused.
      pollFingerprint: (root) => git.getWatchFingerprint(root),
      shouldPoll: () => BrowserWindow.getAllWindows().some((win) => win.isFocused())
    })
    return getRepoWatchState()
  })

  ipcMain.handle(IpcChannels.repo.unwatch, async (event) => {
    assertSender(event)
    watchRequest++
    stopRepoWatch()
  })

  ipcMain.handle(IpcChannels.repo.get, async (event, id: unknown) => {
    assertSender(event)
    const key = parseAccountId(id)
    const existing = loadRepositories().find(
      (r) => r.id === key || normalize(r.path).toLowerCase() === normalize(key).toLowerCase()
    )
    if (!existing) return null
    const fresh = await git.inspectRepository(existing.path)
    upsertRepository(fresh)
    return fresh
  })

  ipcMain.handle(IpcChannels.repo.status, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.getStatus(parseRepoPath(repoPath))
  })

  ipcMain.handle(IpcChannels.repo.branches, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.getBranches(parseRepoPath(repoPath))
  })

  ipcMain.handle(IpcChannels.repo.remoteBranches, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.getRemoteBranches(parseRepoPath(repoPath))
  })
}
