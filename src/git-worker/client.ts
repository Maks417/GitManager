/**
 * Main-process client for git ops. Prefers Electron utilityProcess on win32 + darwin;
 * falls back to in-process operations if fork fails.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import * as ops from './operations'
import { cancelAllGit as cancelAllGitLocal, probeGit } from './git-runner'

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

let child: UtilityProcess | null = null
let childReady = false
let useInline = false
let nextId = 1
const pending = new Map<number, Pending>()

function workerScriptPath(): string {
  // electron-vite emits sibling `git-utility.js` next to main `index.js`
  const candidate = join(__dirname, 'git-utility.js')
  if (existsSync(candidate)) return candidate
  // Dev fallback when running from source maps / different layout
  return join(app.getAppPath(), 'out', 'main', 'git-utility.js')
}

function attachChild(proc: UtilityProcess): void {
  child = proc
  childReady = false
  proc.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return
    const m = msg as { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string }
    if (m.type === 'ready') {
      childReady = true
      return
    }
    if (typeof m.id !== 'number') return
    const wait = pending.get(m.id)
    if (!wait) return
    pending.delete(m.id)
    if (m.ok) wait.resolve(m.result)
    else wait.reject(new Error(m.error || 'Git worker error'))
  })
  proc.on('exit', () => {
    child = null
    childReady = false
    for (const [, wait] of pending) {
      wait.reject(new Error('Git worker exited'))
    }
    pending.clear()
  })
}

function ensureWorker(): void {
  if (useInline || child) return
  try {
    const script = workerScriptPath()
    if (!existsSync(script)) {
      useInline = true
      return
    }
    const proc = utilityProcess.fork(script, [], {
      serviceName: 'git-manager-git',
      stdio: 'pipe'
    })
    attachChild(proc)
  } catch {
    useInline = true
    child = null
  }
}

async function waitReady(timeoutMs = 5000): Promise<boolean> {
  if (useInline) return false
  if (childReady) return true
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (childReady) return true
    if (!child) return false
    await new Promise((r) => setTimeout(r, 20))
  }
  return childReady
}

async function invoke(method: string, args: unknown[]): Promise<unknown> {
  ensureWorker()
  if (useInline || !child) {
    return invokeInline(method, args)
  }
  const ready = await waitReady()
  if (!ready || !child) {
    useInline = true
    return invokeInline(method, args)
  }

  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      child!.postMessage({ id, method, args })
    } catch (err) {
      pending.delete(id)
      useInline = true
      void invokeInline(method, args).then(resolve, reject)
      void err
    }
  })
}

async function invokeInline(method: string, args: unknown[]): Promise<unknown> {
  const map: Record<string, (...a: never[]) => unknown> = {
    inspectRepository: ops.inspectRepository,
    initRepository: ops.initRepository,
    cloneRepository: ops.cloneRepository,
    loadHistory: ops.loadHistory,
    getCommitDetail: ops.getCommitDetail,
    getFileDiff: ops.getFileDiff,
    getWorkingTreeDiff: ops.getWorkingTreeDiff,
    getStatus: ops.getStatus,
    getBranches: ops.getBranches,
    stagePaths: ops.stagePaths,
    unstagePaths: ops.unstagePaths,
    discardPaths: ops.discardPaths,
    commit: ops.commit,
    fetchRemote: ops.fetchRemote,
    pullRemote: ops.pullRemote,
    pushRemote: ops.pushRemote,
    checkoutRef: ops.checkoutRef,
    createBranch: ops.createBranch,
    mergeRef: ops.mergeRef,
    rebaseOnto: ops.rebaseOnto,
    rebaseContinue: ops.rebaseContinue,
    rebaseAbort: ops.rebaseAbort,
    isRebaseInProgress: ops.isRebaseInProgress,
    deleteBranch: ops.deleteBranch,
    stashSave: ops.stashSave,
    listStashes: ops.listStashes,
    stashApply: ops.stashApply,
    stashPop: ops.stashPop,
    stashDrop: ops.stashDrop,
    listConflictFiles: ops.listConflictFiles,
    getMergeSides: ops.getMergeSides,
    saveMergeResult: ops.saveMergeResult,
    getGitIdentity: ops.getGitIdentity,
    setGitIdentity: ops.setGitIdentity
  }
  const fn = map[method]
  if (!fn) throw new Error(`Unknown git method: ${method}`)
  return (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
}

export function cancelAllGit(): void {
  if (child && !useInline) {
    void invoke('cancelAllGit', []).catch(() => undefined)
  }
  cancelAllGitLocal()
}

export { probeGit }

export const inspectRepository = (...args: Parameters<typeof ops.inspectRepository>) =>
  invoke('inspectRepository', args) as ReturnType<typeof ops.inspectRepository>
export const initRepository = (...args: Parameters<typeof ops.initRepository>) =>
  invoke('initRepository', args) as ReturnType<typeof ops.initRepository>
export const cloneRepository = (...args: Parameters<typeof ops.cloneRepository>) =>
  invoke('cloneRepository', args) as ReturnType<typeof ops.cloneRepository>
export const loadHistory = (...args: Parameters<typeof ops.loadHistory>) =>
  invoke('loadHistory', args) as ReturnType<typeof ops.loadHistory>
export const getCommitDetail = (...args: Parameters<typeof ops.getCommitDetail>) =>
  invoke('getCommitDetail', args) as ReturnType<typeof ops.getCommitDetail>
export const getFileDiff = (...args: Parameters<typeof ops.getFileDiff>) =>
  invoke('getFileDiff', args) as ReturnType<typeof ops.getFileDiff>
export const getWorkingTreeDiff = (...args: Parameters<typeof ops.getWorkingTreeDiff>) =>
  invoke('getWorkingTreeDiff', args) as ReturnType<typeof ops.getWorkingTreeDiff>
export const getStatus = (...args: Parameters<typeof ops.getStatus>) =>
  invoke('getStatus', args) as ReturnType<typeof ops.getStatus>
export const getBranches = (...args: Parameters<typeof ops.getBranches>) =>
  invoke('getBranches', args) as ReturnType<typeof ops.getBranches>
export const stagePaths = (...args: Parameters<typeof ops.stagePaths>) =>
  invoke('stagePaths', args) as ReturnType<typeof ops.stagePaths>
export const unstagePaths = (...args: Parameters<typeof ops.unstagePaths>) =>
  invoke('unstagePaths', args) as ReturnType<typeof ops.unstagePaths>
export const discardPaths = (...args: Parameters<typeof ops.discardPaths>) =>
  invoke('discardPaths', args) as ReturnType<typeof ops.discardPaths>
export const commit = (...args: Parameters<typeof ops.commit>) =>
  invoke('commit', args) as ReturnType<typeof ops.commit>
export const fetchRemote = (...args: Parameters<typeof ops.fetchRemote>) =>
  invoke('fetchRemote', args) as ReturnType<typeof ops.fetchRemote>
export const pullRemote = (...args: Parameters<typeof ops.pullRemote>) =>
  invoke('pullRemote', args) as ReturnType<typeof ops.pullRemote>
export const pushRemote = (...args: Parameters<typeof ops.pushRemote>) =>
  invoke('pushRemote', args) as ReturnType<typeof ops.pushRemote>
export const checkoutRef = (...args: Parameters<typeof ops.checkoutRef>) =>
  invoke('checkoutRef', args) as ReturnType<typeof ops.checkoutRef>
export const createBranch = (...args: Parameters<typeof ops.createBranch>) =>
  invoke('createBranch', args) as ReturnType<typeof ops.createBranch>
export const mergeRef = (...args: Parameters<typeof ops.mergeRef>) =>
  invoke('mergeRef', args) as ReturnType<typeof ops.mergeRef>
export const rebaseOnto = (...args: Parameters<typeof ops.rebaseOnto>) =>
  invoke('rebaseOnto', args) as ReturnType<typeof ops.rebaseOnto>
export const rebaseContinue = (...args: Parameters<typeof ops.rebaseContinue>) =>
  invoke('rebaseContinue', args) as ReturnType<typeof ops.rebaseContinue>
export const rebaseAbort = (...args: Parameters<typeof ops.rebaseAbort>) =>
  invoke('rebaseAbort', args) as ReturnType<typeof ops.rebaseAbort>
export const isRebaseInProgress = (...args: Parameters<typeof ops.isRebaseInProgress>) =>
  invoke('isRebaseInProgress', args) as ReturnType<typeof ops.isRebaseInProgress>
export const deleteBranch = (...args: Parameters<typeof ops.deleteBranch>) =>
  invoke('deleteBranch', args) as ReturnType<typeof ops.deleteBranch>
export const stashSave = (...args: Parameters<typeof ops.stashSave>) =>
  invoke('stashSave', args) as ReturnType<typeof ops.stashSave>
export const listStashes = (...args: Parameters<typeof ops.listStashes>) =>
  invoke('listStashes', args) as ReturnType<typeof ops.listStashes>
export const stashApply = (...args: Parameters<typeof ops.stashApply>) =>
  invoke('stashApply', args) as ReturnType<typeof ops.stashApply>
export const stashPop = (...args: Parameters<typeof ops.stashPop>) =>
  invoke('stashPop', args) as ReturnType<typeof ops.stashPop>
export const stashDrop = (...args: Parameters<typeof ops.stashDrop>) =>
  invoke('stashDrop', args) as ReturnType<typeof ops.stashDrop>
export const listConflictFiles = (...args: Parameters<typeof ops.listConflictFiles>) =>
  invoke('listConflictFiles', args) as ReturnType<typeof ops.listConflictFiles>
export const getMergeSides = (...args: Parameters<typeof ops.getMergeSides>) =>
  invoke('getMergeSides', args) as ReturnType<typeof ops.getMergeSides>
export const saveMergeResult = (...args: Parameters<typeof ops.saveMergeResult>) =>
  invoke('saveMergeResult', args) as ReturnType<typeof ops.saveMergeResult>
export const getGitIdentity = (...args: Parameters<typeof ops.getGitIdentity>) =>
  invoke('getGitIdentity', args) as ReturnType<typeof ops.getGitIdentity>
export const setGitIdentity = (...args: Parameters<typeof ops.setGitIdentity>) =>
  invoke('setGitIdentity', args) as ReturnType<typeof ops.setGitIdentity>

export { friendlyCommitError } from './operations'
