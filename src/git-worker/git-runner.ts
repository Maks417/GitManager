import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { isPathInside } from './path-utils'
import { killProcessTree, treeSpawnOptions } from './process-tree'
import {
  createLineSplitter,
  isProgressNoise,
  parseGitProgressLine,
  type GitProgressLine
} from './progress'

export interface GitRunOptions {
  cwd: string
  args: string[]
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  /** Soft cap on accumulated stdout characters; further chunks are dropped. */
  maxStdoutChars?: number
  /** Stop the command and the processes it started when aborted; the run rejects with GitCancelledError. */
  signal?: AbortSignal
  /** Stop the command after this long without any output on stdout or stderr. */
  idleTimeoutMs?: number
  /** Git `--progress` updates. Progress lines are then left out of `stderr`, which keeps its last 64 KB. */
  onProgress?: (progress: GitProgressLine) => void
}

export interface GitRunResult {
  stdout: string
  stderr: string
  code: number
}

export interface GitDelimitedResult {
  records: string[]
  stderr: string
  code: number
}

export interface GitProbeResult {
  available: boolean
  version: string | null
  message: string | null
}

/** A run that was stopped through its AbortSignal. */
export class GitCancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'GitCancelledError'
  }
}

export const GIT_NOT_FOUND_MESSAGE =
  'Git was not found on this computer. Install Git from https://git-scm.com/downloads, then restart Git Manager.'

const GIT_NOT_FOUND_MESSAGE_DARWIN = `${GIT_NOT_FOUND_MESSAGE} On macOS you can also install Xcode Command Line Tools or Homebrew Git.`

/** Error text keeps the end of stderr, where Git says what failed. */
const MAX_RETAINED_STDERR = 64_000

/** How long a stopped command may take to exit before its run settles anyway. */
const STOP_WAIT_MS = 5000

interface ActiveGit {
  cwd: string
  child: ChildProcessWithoutNullStreams
  /** Runs in its own process group: stop it with killProcessTree. */
  tree: boolean
}

const active = new Map<number, ActiveGit>()
let nextActiveId = 1

function track(cwd: string, child: ChildProcessWithoutNullStreams, tree = false): number {
  const id = nextActiveId++
  active.set(id, { cwd, child, tree })
  return id
}

export function resolveGitBinary(): string {
  const bundled = process.env.GIT_MANAGER_GIT_PATH?.trim()
  if (bundled) return bundled
  return process.platform === 'win32' ? 'git.exe' : 'git'
}

export function gitNotFoundMessage(): string {
  return process.platform === 'darwin' ? GIT_NOT_FOUND_MESSAGE_DARWIN : GIT_NOT_FOUND_MESSAGE
}

function isMissingGitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = 'code' in err ? String((err as { code?: unknown }).code) : ''
  // ENOENT: binary missing from PATH. EFTYPE: present but not a valid executable (e.g. empty file on Windows).
  if (code === 'ENOENT' || code === 'EFTYPE') return true
  const message = 'message' in err ? String((err as { message?: unknown }).message) : ''
  return /\bENOENT\b/i.test(message) || /\bEFTYPE\b/i.test(message) || /spawn .+ ENOENT/i.test(message)
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1***:***@')
    .replace(/(ghp_|gho_|ghu_|ghs_|ghr_|glpat-|bbp_)[A-Za-z0-9_]+/g, '$1***')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1***')
}

function describeDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  const seconds = Math.max(1, Math.round(ms / 1000))
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

function spawnGit(opts: Pick<GitRunOptions, 'cwd' | 'args' | 'env'>, tree = false): ChildProcessWithoutNullStreams {
  // Node reports a missing cwd as "spawn git ENOENT", which would read as "Git is not installed".
  if (!existsSync(opts.cwd)) throw new Error(`Repository folder not found: ${opts.cwd}`)
  const git = resolveGitBinary()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    // Background reads (status on every file change) must not take the index lock: that rewrites
    // .git/index, re-triggers the watcher, and makes the user's own git commands fail on index.lock.
    GIT_OPTIONAL_LOCKS: '0'
  }
  // Paths are parsed from stdout; never let Git octal-quote non-ASCII names.
  return spawn(git, ['-c', 'core.quotePath=false', ...opts.args], {
    cwd: opts.cwd,
    env,
    windowsHide: true,
    shell: false,
    ...(tree ? treeSpawnOptions() : {})
  })
}

export async function runGit(opts: GitRunOptions): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new GitCancelledError())
      return
    }
    // Stoppable runs get their own process group, so the helpers they start can be stopped too.
    const tree = Boolean(opts.signal || opts.idleTimeoutMs)
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnGit(opts, tree)
    } catch (err) {
      reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      return
    }

    const key = track(opts.cwd, child, tree)
    // Decode across chunk boundaries so multi-byte UTF-8 characters are never split.
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')

    let stdout = ''
    let stderr = ''
    const retainedStderr: string[] = []
    let settled = false
    const maxChars = opts.maxStdoutChars
    let timer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const onAbort = (): void => stop(new GitCancelledError())

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      active.delete(key)
    }

    const stop = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (tree) killProcessTree(child)
      else child.kill('SIGTERM')
      // Settle once the process, and every helper holding its output pipes, has exited: until then Windows
      // keeps its files and working folder locked, and a caller cleaning up after it would fail.
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(giveUp)
        reject(error)
      }
      const giveUp = setTimeout(finish, STOP_WAIT_MS)
      child.once('close', finish)
    }

    // Any output shows the command is alive; silence for idleTimeoutMs means a stalled network or a
    // prompt nobody can answer.
    const touch = (): void => {
      if (!opts.idleTimeoutMs || settled) return
      if (idleTimer) clearTimeout(idleTimer)
      const limit = opts.idleTimeoutMs
      idleTimer = setTimeout(
        () =>
          stop(
            new Error(
              `git ${opts.args[0]} stopped responding (no output for ${describeDuration(limit)}) and was stopped. Check the network connection and credentials, then try again.`
            )
          ),
        limit
      )
    }

    const progressLines = opts.onProgress
      ? createLineSplitter((line) => {
          const progress = parseGitProgressLine(line)
          if (progress) opts.onProgress?.(progress)
          else if (!isProgressNoise(line)) retainedStderr.push(line)
        })
      : null

    if (opts.timeoutMs) {
      timer = setTimeout(() => stop(new Error(`git ${opts.args[0]} timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
    }
    touch()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (buf: Buffer) => {
      touch()
      const chunk = outDecoder.write(buf)
      if (maxChars === undefined || stdout.length < maxChars) {
        if (maxChars !== undefined && stdout.length + chunk.length > maxChars) {
          stdout += chunk.slice(0, maxChars - stdout.length)
        } else {
          stdout += chunk
        }
      }
    })
    child.stderr.on('data', (buf: Buffer) => {
      touch()
      const chunk = errDecoder.write(buf)
      if (progressLines) progressLines.write(chunk)
      else stderr += chunk
    })

    // Git may exit before reading stdin; without a listener the EPIPE would crash the process.
    child.stdin.on('error', () => undefined)
    if (opts.input) child.stdin.end(opts.input)
    else child.stdin.end()

    child.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      const tail = outDecoder.end()
      if (maxChars === undefined || stdout.length < maxChars) stdout += tail
      if (progressLines) {
        progressLines.write(errDecoder.end())
        progressLines.end()
        stderr = retainedStderr.join('\n')
        if (stderr.length > MAX_RETAINED_STDERR) stderr = stderr.slice(-MAX_RETAINED_STDERR)
      } else {
        stderr += errDecoder.end()
      }
      resolve({ stdout, stderr: redactSecrets(stderr), code: code ?? 1 })
    })
  })
}

/**
 * Stream-parse delimiter-separated stdout (e.g. git log `%x1e` records) without holding one giant string.
 * Stops the child once `maxRecords` complete records are collected, or once `stopWhen` says so.
 */
export async function runGitDelimited(
  opts: GitRunOptions & {
    delimiter: string
    maxRecords?: number
    /** Called after each record; return true to stop reading. */
    stopWhen?: (records: readonly string[]) => boolean
  }
): Promise<GitDelimitedResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnGit(opts)
    } catch (err) {
      reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      return
    }

    const key = track(opts.cwd, child)
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')

    const records: string[] = []
    let pending = ''
    let stderr = ''
    let settled = false
    const maxRecords = opts.maxRecords

    const finish = (code: number): void => {
      if (settled) return
      settled = true
      active.delete(key)
      if (pending.trim()) records.push(pending)
      resolve({ records, stderr: redactSecrets(stderr), code })
    }

    child.stdout.on('data', (buf: Buffer) => {
      if (settled) return
      pending += outDecoder.write(buf)
      let idx = pending.indexOf(opts.delimiter)
      while (idx >= 0) {
        const piece = pending.slice(0, idx)
        pending = pending.slice(idx + opts.delimiter.length)
        if (piece.trim()) {
          records.push(piece)
          if ((maxRecords !== undefined && records.length >= maxRecords) || opts.stopWhen?.(records)) {
            // What follows is a record cut off part way: not a record.
            pending = ''
            child.kill('SIGTERM')
            finish(0)
            return
          }
        }
        idx = pending.indexOf(opts.delimiter)
      }
    })
    child.stderr.on('data', (buf: Buffer) => {
      stderr += errDecoder.write(buf)
    })
    // Git may exit, or be stopped, before reading all of stdin; without a listener the EPIPE would crash the process.
    child.stdin.on('error', () => undefined)
    if (opts.input) child.stdin.end(opts.input)
    else child.stdin.end()

    child.on('error', (err) => {
      active.delete(key)
      if (!settled) {
        settled = true
        reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      }
    })

    child.on('close', (code) => {
      if (!settled) {
        pending += outDecoder.end()
        stderr += errDecoder.end()
      }
      finish(code ?? 1)
    })
  })
}

/**
 * Stream at most `maxBytes` from `git show <spec>` for diff display (Windows + macOS).
 */
export async function readGitShowCapped(
  cwd: string,
  spec: string,
  maxBytes: number
): Promise<{ buffer: Buffer; binary: boolean; truncated: boolean; ok: boolean }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnGit({ cwd, args: ['show', spec] })
    } catch (err) {
      reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      return
    }

    const key = track(cwd, child)

    const chunks: Buffer[] = []
    let total = 0
    let binary = false
    let truncated = false
    let settled = false

    child.stdout.on('data', (buf: Buffer) => {
      if (settled) return
      if (!binary && buf.includes(0)) binary = true
      if (total < maxBytes) {
        const take = buf.subarray(0, Math.min(buf.length, maxBytes - total))
        chunks.push(Buffer.from(take))
        total += take.length
        if (take.length < buf.length) truncated = true
      } else {
        truncated = true
      }
      if (binary || total >= maxBytes) {
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', () => {
      /* ignore missing-blob stderr */
    })
    child.stdin.end()

    child.on('error', (err) => {
      active.delete(key)
      if (!settled) {
        settled = true
        if (isMissingGitError(err)) reject(new Error(gitNotFoundMessage()))
        else resolve({ buffer: Buffer.concat(chunks), binary, truncated, ok: false })
      }
    })

    child.on('close', (code) => {
      active.delete(key)
      if (!settled) {
        settled = true
        resolve({ buffer: Buffer.concat(chunks), binary, truncated, ok: (code ?? 1) === 0 || total > 0 })
      }
    })
  })
}

export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const result = await runGit({ cwd, args })
  if (result.code !== 0) {
    throw new Error(redactSecrets(result.stderr || result.stdout || `git ${args[0]} failed (${result.code})`))
  }
  return result.stdout
}

export async function probeGit(): Promise<GitProbeResult> {
  try {
    const result = await runGit({ cwd: tmpdir(), args: ['--version'], timeoutMs: 10_000 })
    const versionMatch = `${result.stdout}\n${result.stderr}`.match(/git version\s+(\S+)/i)
    if (result.code === 0 && versionMatch) {
      return { available: true, version: versionMatch[1], message: null }
    }
  } catch {
    // Spawn failures and timeouts mean Git is not usable either.
  }
  // Includes the macOS Command Line Tools stub, which exits non-zero without a version.
  return { available: false, version: null, message: gitNotFoundMessage() }
}

export function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function killEntry(id: number, entry: ActiveGit): void {
  try {
    if (entry.tree) killProcessTree(entry.child)
    else entry.child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  active.delete(id)
}

export function cancelAllGit(): void {
  for (const [id, entry] of active) killEntry(id, entry)
}

/** Kill only git processes running in `root` or one of its subdirectories. */
export function cancelGitIn(root: string): void {
  for (const [id, entry] of active) {
    if (isPathInside(root, entry.cwd)) killEntry(id, entry)
  }
}
