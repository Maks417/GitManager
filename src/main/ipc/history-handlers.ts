import { ipcMain } from 'electron'
import {
  DiffRequestSchema,
  HistoryQuerySchema,
  IpcChannels,
  WorkingTreeDiffRequestSchema
} from '@shared/ipc'
import * as git from '../../git-worker/client'
import { assertSender } from './assert-sender'
import { parseRef, parseRepoPath } from './parse'

export function registerHistoryHandlers(): void {
  ipcMain.handle(IpcChannels.history.load, async (event, raw: unknown) => {
    assertSender(event)
    return git.loadHistory(HistoryQuerySchema.parse(raw))
  })

  ipcMain.handle(IpcChannels.history.commitDetail, async (event, repoPath: unknown, sha: unknown) => {
    assertSender(event)
    return git.getCommitDetail(parseRepoPath(repoPath), parseRef(sha))
  })

  ipcMain.handle(IpcChannels.history.fileDiff, async (event, raw: unknown) => {
    assertSender(event)
    const req = DiffRequestSchema.parse(raw)
    return git.getFileDiff(req.repoPath, req.sha, req.path, req.parentIndex)
  })

  ipcMain.handle(IpcChannels.history.workingTreeDiff, async (event, raw: unknown) => {
    assertSender(event)
    const req = WorkingTreeDiffRequestSchema.parse(raw)
    return git.getWorkingTreeDiff(req.repoPath, req.path, req.side)
  })
}
