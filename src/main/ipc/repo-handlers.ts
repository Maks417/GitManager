import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { join, normalize, resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { z } from 'zod'
import { CloneRequestSchema, IpcChannels } from '@shared/ipc'
import * as git from '../../git-worker/client'
import { cancelGitIn } from '../../git-worker/client'
import { isPathInside } from '../../git-worker/path-utils'
import { loadPreferences, loadRepositories, saveRepositories } from '../storage'
import { getWatchedRepoPath, startRepoWatch, stopRepoWatch } from '../repo-watcher'
import { assertDeletableRepoDir } from '../repo-removal'
import { repoNameFromUrl } from '../clone-target'
import { assertSender } from './assert-sender'
import { upsertRepository } from './repo-store'
import { NonEmptyStringSchema, parseAccountId, parseRepoPath } from './parse'

const RemoveOptionsSchema = z.object({ deleteFiles: z.boolean().optional() }).optional()

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
    const id = NonEmptyStringSchema.parse(rawId)
    const repo = loadRepositories().find((r) => r.id === id)
    if (!repo) throw new Error('Repository not found')
    const info = await git.inspectRepoForRemoval(repo.path)
    return { path: resolve(repo.path), ...info }
  })

  ipcMain.handle(IpcChannels.repo.remove, async (event, rawId: unknown, rawOptions?: unknown) => {
    assertSender(event)
    const id = NonEmptyStringSchema.parse(rawId)
    const deleteFiles = Boolean(RemoveOptionsSchema.parse(rawOptions)?.deleteFiles)
    const repos = loadRepositories()
    const repo = repos.find((r) => r.id === id)
    if (!repo) return

    if (deleteFiles && existsSync(repo.path)) {
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

  ipcMain.handle(IpcChannels.repo.create, async (event, path: unknown) => {
    assertSender(event)
    const dir = parseRepoPath(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const repo = await git.initRepository(dir)
    upsertRepository(repo)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.clone, async (event, raw: unknown) => {
    assertSender(event)
    const request = CloneRequestSchema.parse(raw)
    const target = join(request.targetDir, repoNameFromUrl(request.url))
    const repo = await git.cloneRepository(request.url, target)
    upsertRepository(repo)
    return repo
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

  ipcMain.handle(IpcChannels.repo.watch, async (event, repoPath: unknown) => {
    assertSender(event)
    const path = parseRepoPath(repoPath)
    const prefs = loadPreferences()
    if (prefs.liveStatusWatch === false) {
      stopRepoWatch()
      return
    }
    startRepoWatch(path, (root, paths) => git.filterIgnoredPaths(root, paths))
  })

  ipcMain.handle(IpcChannels.repo.unwatch, async (event) => {
    assertSender(event)
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
    const prefs = loadPreferences()
    return git.getStatus(parseRepoPath(repoPath), prefs.statusUntracked ?? 'normal')
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
