import { ipcMain } from 'electron'
import { IpcChannels, SetGitIdentityRequestSchema } from '@shared/ipc'
import { z } from 'zod'
import * as git from '../../git-worker/client'
import { probeGit } from '../../git-worker/client'
import { assertSender } from './assert-sender'
import { NonEmptyStringSchema, parsePaths, parseRef, parseRepoPath } from './parse'

const optionalString = z.string().optional()
const optionalBool = z.boolean().optional()

export function registerGitHandlers(): void {
  ipcMain.handle(IpcChannels.git.probe, async (event) => {
    assertSender(event)
    return probeGit()
  })

  ipcMain.handle(IpcChannels.git.stage, async (event, repoPath: unknown, paths: unknown) => {
    assertSender(event)
    await git.stagePaths(parseRepoPath(repoPath), parsePaths(paths))
  })
  ipcMain.handle(IpcChannels.git.unstage, async (event, repoPath: unknown, paths: unknown) => {
    assertSender(event)
    await git.unstagePaths(parseRepoPath(repoPath), parsePaths(paths))
  })
  ipcMain.handle(
    IpcChannels.git.commit,
    async (event, repoPath: unknown, message: unknown, amend?: unknown) => {
      assertSender(event)
      return git.commit(
        parseRepoPath(repoPath),
        NonEmptyStringSchema.parse(message),
        optionalBool.parse(amend)
      )
    }
  )
  ipcMain.handle(IpcChannels.git.fetch, async (event, repoPath: unknown) => {
    assertSender(event)
    await git.fetchRemote(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.pull, async (event, repoPath: unknown) => {
    assertSender(event)
    await git.pullRemote(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.push, async (event, repoPath: unknown) => {
    assertSender(event)
    await git.pushRemote(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.checkout, async (event, repoPath: unknown, ref: unknown) => {
    assertSender(event)
    await git.checkoutRef(parseRepoPath(repoPath), parseRef(ref))
  })
  ipcMain.handle(
    IpcChannels.git.checkoutRemoteBranch,
    async (event, repoPath: unknown, remoteRef: unknown) => {
      assertSender(event)
      await git.checkoutRemoteBranch(parseRepoPath(repoPath), parseRef(remoteRef))
    }
  )
  ipcMain.handle(
    IpcChannels.git.createBranch,
    async (event, repoPath: unknown, name: unknown, checkout?: unknown) => {
      assertSender(event)
      await git.createBranch(parseRepoPath(repoPath), parseRef(name), optionalBool.parse(checkout) ?? true)
    }
  )
  ipcMain.handle(
    IpcChannels.git.deleteBranch,
    async (event, repoPath: unknown, name: unknown, force?: unknown) => {
      assertSender(event)
      await git.deleteBranch(parseRepoPath(repoPath), parseRef(name), optionalBool.parse(force) ?? false)
    }
  )
  ipcMain.handle(IpcChannels.git.merge, async (event, repoPath: unknown, ref: unknown) => {
    assertSender(event)
    return git.mergeRef(parseRepoPath(repoPath), parseRef(ref))
  })
  ipcMain.handle(IpcChannels.git.rebase, async (event, repoPath: unknown, upstream: unknown) => {
    assertSender(event)
    return git.rebaseOnto(parseRepoPath(repoPath), parseRef(upstream))
  })
  ipcMain.handle(IpcChannels.git.rebaseContinue, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.rebaseContinue(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.rebaseAbort, async (event, repoPath: unknown) => {
    assertSender(event)
    await git.rebaseAbort(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.rebaseInProgress, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.isRebaseInProgress(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.stash, async (event, repoPath: unknown, message?: unknown) => {
    assertSender(event)
    await git.stashSave(parseRepoPath(repoPath), optionalString.parse(message))
  })
  ipcMain.handle(IpcChannels.git.stashList, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.listStashes(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.stashApply, async (event, repoPath: unknown, ref?: unknown) => {
    assertSender(event)
    await git.stashApply(parseRepoPath(repoPath), optionalString.parse(ref))
  })
  ipcMain.handle(IpcChannels.git.stashPop, async (event, repoPath: unknown, ref?: unknown) => {
    assertSender(event)
    await git.stashPop(parseRepoPath(repoPath), optionalString.parse(ref))
  })
  ipcMain.handle(IpcChannels.git.stashDrop, async (event, repoPath: unknown, ref?: unknown) => {
    assertSender(event)
    await git.stashDrop(parseRepoPath(repoPath), optionalString.parse(ref))
  })
  ipcMain.handle(IpcChannels.git.discard, async (event, repoPath: unknown, paths: unknown) => {
    assertSender(event)
    await git.discardPaths(parseRepoPath(repoPath), parsePaths(paths))
  })
  ipcMain.handle(IpcChannels.git.getIdentity, async (event, repoPath: unknown) => {
    assertSender(event)
    return git.getGitIdentity(parseRepoPath(repoPath))
  })
  ipcMain.handle(IpcChannels.git.setIdentity, async (event, raw: unknown) => {
    assertSender(event)
    const req = SetGitIdentityRequestSchema.parse(raw)
    return git.setGitIdentity(req.repoPath, req.name, req.email, req.scope)
  })
}
