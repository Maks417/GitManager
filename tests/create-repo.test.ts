import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  createRepository,
  getDefaultBranchName,
  getEnclosingWorkTree
} from '../src/git-worker/operations'
import { runGit } from '../src/git-worker/git-runner'
import { describeNewRepoTarget } from '../src/main/new-repo'
import { repoFolderNameProblem } from '../src/shared/repo-name'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

/** Runs `fn` with Git configuration passed through the environment, as `git -c` would pass it. */
async function withGitConfig<T>(entries: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const keys = ['GIT_CONFIG_COUNT', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']
  const saved = new Map<string, string | undefined>()
  const pairs = Object.entries(entries)
  for (const key of [...keys, ...pairs.flatMap((_, i) => [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`])]) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.GIT_CONFIG_COUNT = String(pairs.length)
  pairs.forEach(([key, value], i) => {
    process.env[`GIT_CONFIG_KEY_${i}`] = key
    process.env[`GIT_CONFIG_VALUE_${i}`] = value
  })
  try {
    return await fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const IDENTITY = { 'user.name': 'Test User', 'user.email': 'test@example.com' }

describe('createRepository', () => {
  it('creates a repository on the chosen branch with a first commit of README.md', async () => {
    const path = join(tempDir('gm-create-'), 'my-project')
    const result = await withGitConfig(IDENTITY, () =>
      createRepository({ path, name: 'my-project', initialBranch: 'trunk', readme: true })
    )
    expect(result.warning).toBeNull()
    expect(result.repo).toMatchObject({ path, name: 'my-project', currentBranch: 'trunk' })
    expect(readFileSync(join(path, 'README.md'), 'utf8')).toBe('# my-project\n')
    expect((await git(path, 'log', '--format=%s')).trim()).toBe('Initial commit')
  }, 30000)

  it('creates an empty repository whose branch has no commits yet', async () => {
    const path = join(tempDir('gm-create-empty-'), 'empty')
    const result = await createRepository({ path, name: 'empty', initialBranch: 'develop', readme: false })
    expect(result).toMatchObject({ warning: null, repo: { currentBranch: 'develop' } })
    expect((await runGit({ cwd: path, args: ['rev-parse', '--verify', 'HEAD'] })).code).not.toBe(0)
  }, 30000)

  it('keeps the repository and warns when Git has no identity for the first commit', async () => {
    const path = join(tempDir('gm-create-noid-'), 'anon')
    const result = await withGitConfig({ 'user.useConfigOnly': 'true' }, () =>
      createRepository({ path, name: 'anon', initialBranch: 'main', readme: true })
    )
    expect(result.warning).toMatch(/name and email/)
    expect(existsSync(join(path, '.git'))).toBe(true)
    expect((await git(path, 'diff', '--cached', '--name-only')).trim()).toBe('README.md')
  }, 30000)

  it('rejects an invalid branch name before creating anything', async () => {
    const path = join(tempDir('gm-create-badref-'), 'nope')
    await expect(
      createRepository({ path, name: 'nope', initialBranch: 'bad..name', readme: false })
    ).rejects.toThrow(/not a valid branch name/)
    await expect(createRepository({ path, name: 'nope', initialBranch: '-x', readme: false })).rejects.toThrow(
      /not a valid branch name/
    )
    expect(existsSync(path)).toBe(false)
  }, 30000)
})

describe('getDefaultBranchName', () => {
  it("uses Git's init.defaultBranch, else main", async () => {
    expect(await getDefaultBranchName()).toBe('main')
    expect(await withGitConfig({ 'init.defaultBranch': 'trunk' }, () => getDefaultBranchName())).toBe('trunk')
  }, 30000)
})

describe('getEnclosingWorkTree', () => {
  it('finds the repository a folder is in, and nothing outside one', async () => {
    const repo = await initRepo(tempDir('gm-enclosing-'))
    mkdirSync(join(repo, 'packages', 'app'), { recursive: true })
    // Git reports the real path: /private/var rather than the /var symlink on macOS, long names rather
    // than 8.3 short ones (RUNNER~1) on Windows.
    const top = await getEnclosingWorkTree(join(repo, 'packages', 'app'))
    expect(realpathSync.native(top!)).toBe(realpathSync.native(repo))
    expect(await getEnclosingWorkTree(tempDir('gm-not-a-repo-'))).toBeNull()
    expect(await getEnclosingWorkTree(join(repo, 'missing'))).toBeNull()
  }, 30000)
})

describe('describeNewRepoTarget', () => {
  it('accepts a new or empty folder in an existing location', () => {
    const parent = tempDir('gm-target-')
    expect(describeNewRepoTarget(parent, 'fresh')).toEqual({ path: join(parent, 'fresh'), problem: null })
    mkdirSync(join(parent, 'empty'))
    expect(describeNewRepoTarget(parent, 'empty').problem).toBeNull()
  })

  it('explains what is wrong with the location or the folder', () => {
    const parent = tempDir('gm-target-bad-')
    mkdirSync(join(parent, 'taken'))
    writeFileSync(join(parent, 'taken', 'file.txt'), 'x')
    writeFileSync(join(parent, 'a-file'), 'x')
    expect(describeNewRepoTarget(parent, 'taken').problem).toMatch(/not empty/)
    expect(describeNewRepoTarget(parent, 'a-file').problem).toMatch(/file with this name/)
    expect(describeNewRepoTarget(join(parent, 'missing'), 'repo').problem).toMatch(/does not exist/)
    expect(describeNewRepoTarget('relative/folder', 'repo').problem).toMatch(/full path/)
    expect(describeNewRepoTarget('', 'repo').problem).toMatch(/Choose the location/)
    expect(describeNewRepoTarget(parent, 'a/b')).toEqual({ path: null, problem: expect.stringMatching(/cannot contain/) })
  })
})

describe('repoFolderNameProblem', () => {
  it('accepts ordinary folder names', () => {
    for (const name of ['my-project', 'Project 2', 'api.v2', '.dotfiles', 'über']) {
      expect(repoFolderNameProblem(name)).toBeNull()
    }
  })

  it('rejects names some operating system cannot use as they are typed', () => {
    expect(repoFolderNameProblem('')).toMatch(/Enter a name/)
    expect(repoFolderNameProblem(' padded')).toMatch(/space/)
    expect(repoFolderNameProblem('what?')).toMatch(/cannot contain/)
    expect(repoFolderNameProblem('..')).toMatch(/only dots/)
    expect(repoFolderNameProblem('name.')).toMatch(/end with a dot/)
    expect(repoFolderNameProblem('CON')).toMatch(/reserved/)
    expect(repoFolderNameProblem('lpt1.txt')).toMatch(/reserved/)
  })
})
