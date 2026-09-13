/**
 * Main-process client for git ops. Prefers Electron utilityProcess on win32 + darwin;
 * falls back to in-process operations if fork fails.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type * as ops from './operations'
import { getGitMethod, type GitMethodName } from './method-registry'
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

async function invoke(method: GitMethodName | 'cancelAllGit', args: unknown[]): Promise<unknown> {
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
  if (method === 'cancelAllGit') {
    cancelAllGitLocal()
    return
  }
  const fn = getGitMethod(method)
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

function wrap<K extends GitMethodName>(method: K) {
  return (...args: Parameters<(typeof ops)[K]>) =>
    invoke(method, args) as ReturnType<(typeof ops)[K]>
}

export const inspectRepository = wrap('inspectRepository')
export const initRepository = wrap('initRepository')
export const cloneRepository = wrap('cloneRepository')
export const loadHistory = wrap('loadHistory')
export const getCommitDetail = wrap('getCommitDetail')
export const getFileDiff = wrap('getFileDiff')
export const getWorkingTreeDiff = wrap('getWorkingTreeDiff')
export const getStatus = wrap('getStatus')
export const getBranches = wrap('getBranches')
export const getRemoteBranches = wrap('getRemoteBranches')
export const stagePaths = wrap('stagePaths')
export const unstagePaths = wrap('unstagePaths')
export const discardPaths = wrap('discardPaths')
export const commit = wrap('commit')
export const fetchRemote = wrap('fetchRemote')
export const pullRemote = wrap('pullRemote')
export const pushRemote = wrap('pushRemote')
export const checkoutRef = wrap('checkoutRef')
export const checkoutRemoteBranch = wrap('checkoutRemoteBranch')
export const createBranch = wrap('createBranch')
export const mergeRef = wrap('mergeRef')
export const rebaseOnto = wrap('rebaseOnto')
export const rebaseContinue = wrap('rebaseContinue')
export const rebaseAbort = wrap('rebaseAbort')
export const isRebaseInProgress = wrap('isRebaseInProgress')
export const deleteBranch = wrap('deleteBranch')
export const stashSave = wrap('stashSave')
export const listStashes = wrap('listStashes')
export const stashApply = wrap('stashApply')
export const stashPop = wrap('stashPop')
export const stashDrop = wrap('stashDrop')
export const listConflictFiles = wrap('listConflictFiles')
export const getMergeSides = wrap('getMergeSides')
export const saveMergeResult = wrap('saveMergeResult')
export const getGitIdentity = wrap('getGitIdentity')
export const setGitIdentity = wrap('setGitIdentity')

export { friendlyCommitError } from './operations'
