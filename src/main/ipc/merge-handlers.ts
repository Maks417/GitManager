import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import { z } from 'zod'
import * as git from '../../git-worker/client'
import { assertSender } from './assert-sender'
import { parseConflictSide, parseRepoPath, parseRepoRelativePath } from './parse'

export function registerMergeHandlers(): void {
  ipcMain.handle(IpcChannels.merge.listConflicts, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.listConflictFiles(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.merge.getSides, async (event, repoPath: unknown, path: unknown) => {
    assertSender(event)
    return git.getMergeSides(parseRepoPath(repoPath), parseRepoRelativePath(path))
  })
  ipcMain.handle(
    IpcChannels.merge.saveResult,
    async (event, repoPath: unknown, path: unknown, content: unknown) => {
      assertSender(event)
      await git.saveMergeResult(
        parseRepoPath(repoPath),
        parseRepoRelativePath(path),
        z.string().parse(content)
      )
    }
  )
  ipcMain.handle(
    IpcChannels.merge.resolveSide,
    async (event, repoPath: unknown, path: unknown, side: unknown) => {
      assertSender(event)
      await git.resolveConflictSide(
        parseRepoPath(repoPath),
        parseRepoRelativePath(path),
        parseConflictSide(side)
      )
    }
  )
}
