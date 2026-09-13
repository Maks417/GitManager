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
}

export interface GitRunResult {
  stdout: string
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

function resolveGitBinary(): string {
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

export async function runGit(opts: GitRunOptions): Promise<GitRunResult> {
  const git = resolveGitBinary()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(git, opts.args, {
        cwd: opts.cwd,
        env,
        windowsHide: true,
        shell: false
      })
    } catch (err) {
      reject(isMissingGitError(err) ? new Error(gitNotFoundMessage()) : err)
      return
    }

    const key = `${opts.cwd}:${opts.args.join(' ')}:${Date.now()}`
    active.set(key, child)

    let stdout = ''
    let stderr = ''
    let settled = false

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
      stdout += chunk
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
