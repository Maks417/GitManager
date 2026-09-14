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

/** Effective user.name / user.email Git will use for commits in this repo. */
export async function getGitIdentity(repoPath: string): Promise<{
  name: string
  email: string
  nameSource: IdentitySource
  emailSource: IdentitySource
}> {
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
): Promise<{
  name: string
  email: string
  nameSource: IdentitySource
  emailSource: IdentitySource
}> {
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
