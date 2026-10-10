import { gitOk, runGit } from './shared'

type IdentitySource = 'local' | 'global' | 'system' | 'unset'

async function readConfigValue(
  repoPath: string,
  key: string,
  scope?: 'local' | 'global' | 'system'
): Promise<string> {
  const args = ['config']
  if (scope) args.push(`--${scope}`)
  args.push('--get', key)
  const result = await runGit({ cwd: repoPath, args })
  if (result.code !== 0) return ''
  return result.stdout.trim()
}

async function resolveIdentitySource(repoPath: string, key: string): Promise<IdentitySource> {
  if (await readConfigValue(repoPath, key, 'local')) return 'local'
  if (await readConfigValue(repoPath, key, 'global')) return 'global'
  if (await readConfigValue(repoPath, key, 'system')) return 'system'
  return 'unset'
}

type GitIdentity = {
  name: string
  email: string
  nameSource: IdentitySource
  emailSource: IdentitySource
}

const FILE_SCOPES: Record<string, IdentitySource> = { system: 'system', global: 'global', local: 'local', worktree: 'local' }

/**
 * Identity from the output of `git config -z --show-scope --get-regexp` (Git 2.26+): every user.name and
 * user.email setting with its scope, lowest priority first, as `<scope>\0<key>\n<value>\0`. The last value
 * wins, as with `git config --get`; the source is the config file of the last non-empty one.
 */
export function parseIdentitySettings(out: string): GitIdentity {
  const identity: GitIdentity = { name: '', email: '', nameSource: 'unset', emailSource: 'unset' }
  const parts = out.split('\0')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i]
    const entry = parts[i + 1]
    const newline = entry.indexOf('\n')
    const key = (newline < 0 ? entry : entry.slice(0, newline)).toLowerCase()
    const value = newline < 0 ? '' : entry.slice(newline + 1).trim()
    const field = key === 'user.name' ? 'name' : key === 'user.email' ? 'email' : null
    if (!field) continue
    identity[field] = value
    const source = FILE_SCOPES[scope]
    if (value && source) identity[field === 'name' ? 'nameSource' : 'emailSource'] = source
  }
  return identity
}

/** Identity from one Git process; null when this Git cannot list scopes. */
async function readIdentityAtOnce(repoPath: string): Promise<GitIdentity | null> {
  const result = await runGit({
    cwd: repoPath,
    args: ['config', '-z', '--show-scope', '--get-regexp', '^user\\.(name|email)$']
  })
  // 1: no setting matched.
  if (result.code === 1) return parseIdentitySettings('')
  return result.code === 0 ? parseIdentitySettings(result.stdout) : null
}

/** Effective user.name / user.email Git will use for commits in this repo. */
export async function getGitIdentity(repoPath: string): Promise<GitIdentity> {
  const atOnce = await readIdentityAtOnce(repoPath)
  if (atOnce) return atOnce
  const [name, email, nameSource, emailSource] = await Promise.all([
    readConfigValue(repoPath, 'user.name'),
    readConfigValue(repoPath, 'user.email'),
    resolveIdentitySource(repoPath, 'user.name'),
    resolveIdentitySource(repoPath, 'user.email')
  ])
  return { name, email, nameSource, emailSource }
}

export async function setGitIdentity(
  repoPath: string,
  name: string,
  email: string,
  scope: 'local' | 'global' = 'local'
): Promise<GitIdentity> {
  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  if (!trimmedName) throw new Error('Name is required')
  if (!trimmedEmail) throw new Error('Email is required')
  if (scope !== 'local' && scope !== 'global') throw new Error(`Invalid config scope: ${String(scope)}`)
  // `--` keeps a value that starts with "-" from being parsed as an option.
  await gitOk(repoPath, ['config', `--${scope}`, '--', 'user.name', trimmedName])
  await gitOk(repoPath, ['config', `--${scope}`, '--', 'user.email', trimmedEmail])
  return getGitIdentity(repoPath)
}
