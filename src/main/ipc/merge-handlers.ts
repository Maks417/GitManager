import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import { z } from 'zod'
import * as git from '../../git-worker/client'
import { assertSender } from './assert-sender'
import { parseRepoPath } from './parse'

export function registerMergeHandlers(): void {
  ipcMain.handle(IpcChannels.merge.listConflicts, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.listConflictFiles(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.merge.getSides, async (event, repoPath: unknown, path: unknown) => {
    assertSender(event)
    return git.getMergeSides(parseRepoPath(repoPath), parseRepoPath(path))
  })
  ipcMain.handle(
    IpcChannels.merge.saveResult,
    async (event, repoPath: unknown, path: unknown, content: unknown) => {
      assertSender(event)
      await git.saveMergeResult(parseRepoPath(repoPath), parseRepoPath(path), z.string().parse(content))
    }
  )
}
