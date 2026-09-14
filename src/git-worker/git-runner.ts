import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { isPathInside } from './path-utils'

export interface GitRunOptions {
  cwd: string
  args: string[]
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  /** Soft cap on accumulated stdout characters; further chunks are dropped. */
  maxStdoutChars?: number
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

export const GIT_NOT_FOUND_MESSAGE =
  'Git was not found on this computer. Install Git from https://git-scm.com/downloads, then restart Git Manager.'

const GIT_NOT_FOUND_MESSAGE_DARWIN = `${GIT_NOT_FOUND_MESSAGE} On macOS you can also install Xcode Command Line Tools or Homebrew Git.`

interface ActiveGit {
  cwd: string
  child: ChildProcessWithoutNullStreams
}

const active = new Map<number, ActiveGit>()
let nextActiveId = 1

function track(cwd: string, child: ChildProcessWithoutNullStreams): number {
  const id = nextActiveId++
  active.set(id, { cwd, child })
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

function spawnGit(opts: Pick<GitRunOptions, 'cwd' | 'args' | 'env'>): ChildProcessWithoutNullStreams {
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
    shell: false
  })
}

export async function runGit(opts: GitRunOptions): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnGit(opts)
    } catch (err) {
      reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      return
    }

    const key = track(opts.cwd, child)
    // Decode across chunk boundaries so multi-byte UTF-8 characters are never split.
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')

    let stdout = ''
    let stderr = ''
    let settled = false
    const maxChars = opts.maxStdoutChars

    const timer =
      opts.timeoutMs &&
      setTimeout(() => {
        child.kill('SIGTERM')
        if (!settled) {
          settled = true
          active.delete(key)
          reject(new Error(`git ${opts.args[0]} timed out after ${opts.timeoutMs}ms`))
        }
      }, opts.timeoutMs)

    child.stdout.on('data', (buf: Buffer) => {
      const chunk = outDecoder.write(buf)
      if (maxChars === undefined || stdout.length < maxChars) {
        if (maxChars !== undefined && stdout.length + chunk.length > maxChars) {
          stdout += chunk.slice(0, maxChars - stdout.length)
        } else {
          stdout += chunk
        }
      }    })
    child.stderr.on('data', (buf: Buffer) => {
      const chunk = errDecoder.write(buf)
      stderr += chunk    })

    // Git may exit before reading stdin; without a listener the EPIPE would crash the process.
    child.stdin.on('error', () => undefined)
    if (opts.input) child.stdin.end(opts.input)
    else child.stdin.end()

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      active.delete(key)
      if (!settled) {
        settled = true
        reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      }
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      active.delete(key)
      if (!settled) {
        settled = true
        const tail = outDecoder.end()
        if (maxChars === undefined || stdout.length < maxChars) stdout += tail
        resolve({
          stdout,
          stderr: redactSecrets(stderr + errDecoder.end()),
          code: code ?? 1
        })
      }
    })
  })
}

/**
 * Stream-parse delimiter-separated stdout (e.g. git log `%x1e` records) without holding one giant string.
 * Stops the child once `maxRecords` complete records are collected.
 */
export async function runGitDelimited(
  opts: GitRunOptions & { delimiter: string; maxRecords?: number }
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
        if (piece.trim()) records.push(piece)
        if (maxRecords !== undefined && records.length >= maxRecords) {
          child.kill('SIGTERM')
          finish(0)
          return
        }
        idx = pending.indexOf(opts.delimiter)
      }
    })
    child.stderr.on('data', (buf: Buffer) => {
      stderr += errDecoder.write(buf)
    })
    child.stdin.end()

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
    entry.child.kill('SIGTERM')
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
