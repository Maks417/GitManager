import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, join, normalize, resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { rm } from 'fs/promises'
import { CloneRequestSchema, IpcChannels } from '@shared/ipc'
import * as git from '../../git-worker/client'
import { cancelAllGit } from '../../git-worker/client'
import { loadPreferences, loadRepositories, saveRepositories } from '../storage'
import { getWatchedRepoPath, startRepoWatch, stopRepoWatch } from '../repo-watcher'
import { assertSender } from './assert-sender'
import { upsertRepository } from './repo-store'
import { parseAccountId, parseRepoPath } from './parse'

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

  ipcMain.handle(
    IpcChannels.repo.remove,
    async (event, id: string, options?: { deleteFiles?: boolean } | boolean) => {
      assertSender(event)
      if (!id || typeof id !== 'string') throw new Error('Invalid repository id')
      const deleteFiles =
        typeof options === 'boolean' ? options : Boolean(options && options.deleteFiles)
      const repos = loadRepositories()
      const repo = repos.find((r) => r.id === id)
      if (!repo) return

      if (deleteFiles) {
        if (!repo.path || typeof repo.path !== 'string') throw new Error('Invalid repository path')
        const target = resolve(normalize(repo.path))
        // Guard against accidentally wiping a drive root (e.g. "C:\").
        if (target.length < 4) throw new Error('Refusing to delete path')
        if (!existsSync(target)) {
          saveRepositories(repos.filter((r) => r.id !== id))
          return
        }

        const watched = getWatchedRepoPath()
        if (watched && resolve(normalize(watched)) === target) stopRepoWatch()
        cancelAllGit()
        // Give watchers / git child processes a moment to release handles (esp. Windows).
        await new Promise((r) => setTimeout(r, 150))

        try {
          await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(
            `Could not delete folder:\n${target}\n\n${msg}\n\nClose other programs using these files and try again.`
          )
        }

        if (existsSync(target)) {
          throw new Error(
            `Could not delete folder:\n${target}\n\nClose other programs using these files and try again.`
          )
        }
      }

      saveRepositories(repos.filter((r) => r.id !== id))
    }
  )

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
    const name = basename(request.url.replace(/\.git$/, '').replace(/\/$/, '').split('/').pop() || 'repo')
    const target = join(request.targetDir, name)
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
    startRepoWatch(path)
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
