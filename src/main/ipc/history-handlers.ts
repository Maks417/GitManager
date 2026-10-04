import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  CompareRequestSchema,
  CompareDiffRequestSchema,
  DiffRequestSchema,
  HistoryQuerySchema,
  IpcChannels,
  WorkingTreeDiffRequestSchema
} from '@shared/ipc'
import * as git from '../../git-worker/client'
import { assertSender } from './assert-sender'
import { NonEmptyStringSchema, parseRef, parseRepoPath } from './parse'

export function registerHistoryHandlers(): void {
  ipcMain.handle(IpcChannels.history.compare, async (event, raw: unknown) => {
    assertSender(event)
    const request = CompareRequestSchema.parse(raw)
    return git.compareRefs(parseRepoPath(request.repoPath), request)
  })
  ipcMain.handle(IpcChannels.history.compareDiff, async (event, raw: unknown) => {
    assertSender(event)
    const request = CompareDiffRequestSchema.parse(raw)
    return git.getComparisonDiff(parseRepoPath(request.repoPath), request)
  })
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
    return git.getFileDiff(req.repoPath, req.sha, req.path, req.parentIndex, req.oldPath)
  })

  ipcMain.handle(IpcChannels.history.workingTreeDiff, async (event, raw: unknown) => {
    assertSender(event)
    const req = WorkingTreeDiffRequestSchema.parse(raw)
    return git.getWorkingTreeDiff(req.repoPath, req.path, req.side)
  })

  ipcMain.handle(IpcChannels.history.fileHistory, async (event, repoPath: unknown, path: unknown, skip?: unknown) => {
    assertSender(event)
    return git.getFileHistory(
      parseRepoPath(repoPath),
      NonEmptyStringSchema.parse(path),
      z.number().int().min(0).optional().parse(skip)
    )
  })

  ipcMain.handle(IpcChannels.history.blame, async (event, repoPath: unknown, path: unknown, rev?: unknown) => {
    assertSender(event)
    return git.getBlame(
      parseRepoPath(repoPath),
      NonEmptyStringSchema.parse(path),
      rev === undefined || rev === null ? undefined : parseRef(rev)
    )
  })
}
