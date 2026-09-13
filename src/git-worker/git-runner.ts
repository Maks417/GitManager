import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface GitRunOptions {
  cwd: string
  args: string[]
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  onProgress?: (line: string) => void
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

const active = new Map<string, ChildProcessWithoutNullStreams>()

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
  const git = resolveGitBinary()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  }
  return spawn(git, opts.args, {
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

    const key = `${opts.cwd}:${opts.args.join(' ')}:${Date.now()}`
    active.set(key, child)

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
      const chunk = buf.toString('utf8')
      if (maxChars === undefined || stdout.length < maxChars) {
        if (maxChars !== undefined && stdout.length + chunk.length > maxChars) {
          stdout += chunk.slice(0, maxChars - stdout.length)
        } else {
          stdout += chunk
        }
      }
      if (opts.onProgress) {
        for (const line of chunk.split(/\r?\n/)) {
          if (line) opts.onProgress(redactSecrets(line))
        }
      }
    })
    child.stderr.on('data', (buf: Buffer) => {
      const chunk = buf.toString('utf8')
      stderr += chunk
      if (opts.onProgress) {
        for (const line of chunk.split(/\r?\n/)) {
          if (line) opts.onProgress(redactSecrets(line))
        }
      }
    })

    if (opts.input) {
      child.stdin.write(opts.input)
      child.stdin.end()
    } else {
      child.stdin.end()
    }

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
        resolve({
          stdout,
          stderr: redactSecrets(stderr),
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

    const key = `${opts.cwd}:delim:${opts.args.join(' ')}:${Date.now()}`
    active.set(key, child)

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
      pending += buf.toString('utf8')
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
      stderr += buf.toString('utf8')
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

    const key = `${cwd}:show:${spec}:${Date.now()}`
    active.set(key, child)

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
  const message = gitNotFoundMessage()
  try {
    const result = await runGit({
      cwd: tmpdir(),
      args: ['--version'],
      timeoutMs: 10_000
    })
    const combined = `${result.stdout}\n${result.stderr}`
    const versionMatch = combined.match(/git version\s+(\S+)/i)
    if (result.code === 0 && versionMatch) {
      return { available: true, version: versionMatch[1], message: null }
    }
    if (/xcode-select|command line tools/i.test(combined)) {
      return { available: false, version: null, message }
    }
    return { available: false, version: null, message }
  } catch (err) {
    if (isMissingGitError(err) || (err instanceof Error && err.message === message)) {
      return { available: false, version: null, message }
    }
    const text = err instanceof Error ? err.message : String(err)
    if (/xcode-select|command line tools|ENOENT|not found/i.test(text)) {
      return { available: false, version: null, message }
    }
    return { available: false, version: null, message }
  }
}

export function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

export function cancelAllGit(): void {
  for (const [, child] of active) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  active.clear()
}
