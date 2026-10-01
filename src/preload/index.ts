import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, MenuChannels } from '@shared/ipc/channels'

const api = {
  repo: {
    list: () => ipcRenderer.invoke(IpcChannels.repo.list),
    add: (path: string) => ipcRenderer.invoke(IpcChannels.repo.add, path),
    remove: (id: string, options?: unknown) => ipcRenderer.invoke(IpcChannels.repo.remove, id, options),
    openDialog: () => ipcRenderer.invoke(IpcChannels.repo.openDialog),
    create: (request: unknown) => ipcRenderer.invoke(IpcChannels.repo.create, request),
    inspectNewRepo: (request: unknown) => ipcRenderer.invoke(IpcChannels.repo.inspectNewRepo, request),
    clone: (request: unknown) => ipcRenderer.invoke(IpcChannels.repo.clone, request),
    get: (id: string) => ipcRenderer.invoke(IpcChannels.repo.get, id),
    status: (repoPath: string) => ipcRenderer.invoke(IpcChannels.repo.status, repoPath),
    branches: (repoPath: string) => ipcRenderer.invoke(IpcChannels.repo.branches, repoPath),
    remoteBranches: (repoPath: string) =>
      ipcRenderer.invoke(IpcChannels.repo.remoteBranches, repoPath),
    pickDirectory: () => ipcRenderer.invoke(IpcChannels.repo.pickDirectory),
    watch: (repoPath: string) => ipcRenderer.invoke(IpcChannels.repo.watch, repoPath),
    unwatch: () => ipcRenderer.invoke(IpcChannels.repo.unwatch),
    onChanged: (callback: (event: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, event: unknown): void => callback(event)
      ipcRenderer.on(IpcChannels.repo.onChanged, listener)
      return () => ipcRenderer.removeListener(IpcChannels.repo.onChanged, listener)
    },
    onWatchState: (callback: (state: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: unknown): void => callback(state)
      ipcRenderer.on(IpcChannels.repo.onWatchState, listener)
      return () => ipcRenderer.removeListener(IpcChannels.repo.onWatchState, listener)
    },
    removalInfo: (id: string) => ipcRenderer.invoke(IpcChannels.repo.removalInfo, id),
    worktreeInfo: (id: string) => ipcRenderer.invoke(IpcChannels.repo.worktreeInfo, id)
  },
  history: {
    load: (query: unknown) => ipcRenderer.invoke(IpcChannels.history.load, query),
    commitDetail: (repoPath: string, sha: string) =>
      ipcRenderer.invoke(IpcChannels.history.commitDetail, repoPath, sha),
    fileDiff: (request: unknown) => ipcRenderer.invoke(IpcChannels.history.fileDiff, request),
    workingTreeDiff: (request: unknown) =>
      ipcRenderer.invoke(IpcChannels.history.workingTreeDiff, request)
  },
  git: {
    probe: () => ipcRenderer.invoke(IpcChannels.git.probe),
    stage: (repoPath: string, paths: string[]) => ipcRenderer.invoke(IpcChannels.git.stage, repoPath, paths),
    unstage: (repoPath: string, paths: string[]) => ipcRenderer.invoke(IpcChannels.git.unstage, repoPath, paths),
    applyPartial: (request: unknown) => ipcRenderer.invoke(IpcChannels.git.applyPartial, request),
    commit: (repoPath: string, message: string, amend?: boolean) =>
      ipcRenderer.invoke(IpcChannels.git.commit, repoPath, message, amend),
    fetch: (request: unknown) => ipcRenderer.invoke(IpcChannels.git.fetch, request),
    pull: (request: unknown) => ipcRenderer.invoke(IpcChannels.git.pull, request),
    push: (request: unknown) => ipcRenderer.invoke(IpcChannels.git.push, request),
    cancelOperation: (opId: string) => ipcRenderer.invoke(IpcChannels.git.cancelOperation, opId),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, progress: unknown): void => callback(progress)
      ipcRenderer.on(IpcChannels.git.onProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.git.onProgress, listener)
    },
    checkout: (repoPath: string, ref: string) => ipcRenderer.invoke(IpcChannels.git.checkout, repoPath, ref),
    checkoutRemoteBranch: (repoPath: string, remoteRef: string) =>
      ipcRenderer.invoke(IpcChannels.git.checkoutRemoteBranch, repoPath, remoteRef),
    createBranch: (repoPath: string, name: string, checkout?: boolean, startPoint?: string) =>
      ipcRenderer.invoke(IpcChannels.git.createBranch, repoPath, name, checkout, startPoint),
    deleteBranch: (repoPath: string, name: string, force?: boolean) =>
      ipcRenderer.invoke(IpcChannels.git.deleteBranch, repoPath, name, force),
    merge: (repoPath: string, ref: string) => ipcRenderer.invoke(IpcChannels.git.merge, repoPath, ref),
    rebase: (repoPath: string, upstream: string) =>
      ipcRenderer.invoke(IpcChannels.git.rebase, repoPath, upstream),
    rebaseContinue: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.rebaseContinue, repoPath),
    rebaseAbort: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.rebaseAbort, repoPath),
    rebaseInProgress: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.rebaseInProgress, repoPath),
    rebaseSkip: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.rebaseSkip, repoPath),
    mergeAbort: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.mergeAbort, repoPath),
    mergeInProgress: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.mergeInProgress, repoPath),
    cherryPick: (repoPath: string, sha: string) => ipcRenderer.invoke(IpcChannels.git.cherryPick, repoPath, sha),
    revert: (repoPath: string, sha: string) => ipcRenderer.invoke(IpcChannels.git.revert, repoPath, sha),
    sequencerOp: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.sequencerOp, repoPath),
    sequencerStep: (repoPath: string, step: string) =>
      ipcRenderer.invoke(IpcChannels.git.sequencerStep, repoPath, step),
    commitsAfter: (repoPath: string, sha: string) => ipcRenderer.invoke(IpcChannels.git.commitsAfter, repoPath, sha),
    reset: (repoPath: string, sha: string, mode: string) =>
      ipcRenderer.invoke(IpcChannels.git.reset, repoPath, sha, mode),
    createTag: (repoPath: string, name: string, sha: string, message?: string) =>
      ipcRenderer.invoke(IpcChannels.git.createTag, repoPath, name, sha, message),
    deleteTag: (repoPath: string, name: string) => ipcRenderer.invoke(IpcChannels.git.deleteTag, repoPath, name),
    pushTag: (request: unknown) => ipcRenderer.invoke(IpcChannels.git.pushTag, request),
    stash: (repoPath: string, message?: string) => ipcRenderer.invoke(IpcChannels.git.stash, repoPath, message),
    stashList: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.stashList, repoPath),
    stashApply: (repoPath: string, ref?: string) =>
      ipcRenderer.invoke(IpcChannels.git.stashApply, repoPath, ref),
    stashPop: (repoPath: string, ref?: string) => ipcRenderer.invoke(IpcChannels.git.stashPop, repoPath, ref),
    stashDrop: (repoPath: string, ref?: string) =>
      ipcRenderer.invoke(IpcChannels.git.stashDrop, repoPath, ref),
    discard: (repoPath: string, paths: string[]) => ipcRenderer.invoke(IpcChannels.git.discard, repoPath, paths),
    getIdentity: (repoPath: string) => ipcRenderer.invoke(IpcChannels.git.getIdentity, repoPath),
    setIdentity: (request: unknown) => ipcRenderer.invoke(IpcChannels.git.setIdentity, request)
  },
  merge: {
    listConflicts: (repoPath: string) => ipcRenderer.invoke(IpcChannels.merge.listConflicts, repoPath),
    getSides: (repoPath: string, path: string) => ipcRenderer.invoke(IpcChannels.merge.getSides, repoPath, path),
    saveResult: (repoPath: string, path: string, content: string) =>
      ipcRenderer.invoke(IpcChannels.merge.saveResult, repoPath, path, content),
    resolveSide: (repoPath: string, path: string, side: string) =>
      ipcRenderer.invoke(IpcChannels.merge.resolveSide, repoPath, path, side)
  },
  providers: {
    listAccounts: () => ipcRenderer.invoke(IpcChannels.providers.listAccounts),
    disconnect: (accountId: string) => ipcRenderer.invoke(IpcChannels.providers.disconnect, accountId),
    listRepos: (accountId: string) => ipcRenderer.invoke(IpcChannels.providers.listRepos, accountId),
    saveToken: (provider: string, token: string, username?: string, baseUrl?: string) =>
      ipcRenderer.invoke(IpcChannels.providers.saveToken, provider, token, username, baseUrl)
  },
  prefs: {
    get: () => ipcRenderer.invoke(IpcChannels.prefs.get),
    set: (prefs: unknown) => ipcRenderer.invoke(IpcChannels.prefs.set, prefs)
  },
  updater: {
    status: () => ipcRenderer.invoke(IpcChannels.updater.status),
    check: () => ipcRenderer.invoke(IpcChannels.updater.check),
    install: () => ipcRenderer.invoke(IpcChannels.updater.install),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, status: unknown): void => callback(status)
      ipcRenderer.on(IpcChannels.updater.onStatus, listener)
      return () => ipcRenderer.removeListener(IpcChannels.updater.onStatus, listener)
    }
  },
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.app.getInfo)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.shell.openExternal, url)
  }
}

contextBridge.exposeInMainWorld('gitManager', api)

const menuChannels = new Set<string>(Object.values(MenuChannels))

contextBridge.exposeInMainWorld('gitManagerMenu', {
  on: (event: string, cb: () => void) => {
    if (!menuChannels.has(event)) throw new Error(`Unknown menu channel: ${event}`)
    const handler = (): void => cb()
    ipcRenderer.on(event, handler)
    return () => ipcRenderer.removeListener(event, handler)
  }
})
