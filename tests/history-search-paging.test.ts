import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { loadHistory } from '../src/git-worker/operations'
import { git, importCommits, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

async function commitAt(dir: string, message: string, isoDate: string, author?: string): Promise<void> {
  const env: NodeJS.ProcessEnv = { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
  const args = ['commit', '--allow-empty', '-m', message]
  if (author) args.push(`--author=${author}`)
  const result = await runGit({ cwd: dir, args, env })
  if (result.code !== 0) throw new Error(result.stderr)
}

async function subjects(dir: string, query: { search?: string; branch?: string; limit?: number; skip?: number }): Promise<string[]> {
  const page = await loadHistory({ repoPath: dir, limit: query.limit ?? 50, ...query })
  return page.commits.map((c) => c.subject)
}

describe('history paging', () => {
  it('pages through all branches without skipping commits of other branches', async () => {
    const dir = await initRepo(tempDir('gm-page-'), { initialCommit: false })
    await commitAt(dir, 'base', '2026-01-01T00:00:00Z')
    await git(dir, 'branch', 'feature')
    const steps: Array<[string, string, string]> = [
      ['feature', 'f1', '2026-01-02T00:00:00Z'],
      ['main', 'm1', '2026-01-03T00:00:00Z'],
      ['feature', 'f2', '2026-01-04T00:00:00Z'],
      ['main', 'm2', '2026-01-05T00:00:00Z'],
      ['feature', 'f3', '2026-01-06T00:00:00Z'],
      ['main', 'm3', '2026-01-07T00:00:00Z']
    ]
    for (const [branch, message, date] of steps) {
      await git(dir, 'checkout', '-q', branch)
      await commitAt(dir, message, date)
    }

    const seen: string[] = []
    for (let skip = 0; ; ) {
      const page = await loadHistory({ repoPath: dir, limit: 3, skip })
      seen.push(...page.commits.map((c) => c.subject))
      if (!page.nextCursor) break
      skip += page.commits.length
    }
    expect(seen).toEqual(['m3', 'f3', 'm2', 'f2', 'm1', 'f1', 'base'])
  }, 30000)

  it('does not show stash entries as history', async () => {
    const dir = await initRepo(tempDir('gm-page-'))
    writeFileSync(join(dir, 'README.md'), 'work in progress\n')
    await git(dir, 'stash')
    expect(await subjects(dir, {})).toEqual(['Initial commit'])
  }, 30000)
})

describe('history search', () => {
  it('matches message text literally, case-insensitively, and pages through matches', async () => {
    const dir = await initRepo(tempDir('gm-search-'))
    const messages = [
      'Fix login bug in form',
      'Refactor settings',
      'fix(auth): handle {beta} tokens',
      'Added a|b switch',
      'Исправить Ошибку входа'
    ]
    for (const [i, message] of messages.entries()) {
      await commitAt(dir, message, `2026-02-0${i + 1}T00:00:00Z`)
    }

    expect(await subjects(dir, { search: 'fix login bug' })).toEqual(['Fix login bug in form'])
    expect(await subjects(dir, { search: 'fix(auth)' })).toEqual(['fix(auth): handle {beta} tokens'])
    expect(await subjects(dir, { search: '{beta}' })).toEqual(['fix(auth): handle {beta} tokens'])
    expect(await subjects(dir, { search: 'a|b' })).toEqual(['Added a|b switch'])
    expect(await subjects(dir, { search: 'added' })).toEqual(['Added a|b switch'])
    expect(await subjects(dir, { search: 'ошибку' })).toEqual(['Исправить Ошибку входа'])

    expect(await subjects(dir, { search: 'fix', limit: 1 })).toEqual(['fix(auth): handle {beta} tokens'])
    expect(await subjects(dir, { search: 'fix', limit: 1, skip: 1 })).toEqual(['Fix login bug in form'])
  }, 30000)

  it('supports author: filters and commit ids', async () => {
    const dir = await initRepo(tempDir('gm-search-'))
    await commitAt(dir, 'Written by Ada', '2026-03-01T00:00:00Z', 'Ada Lovelace <ada@example.com>')
    await commitAt(dir, 'Written by the test user', '2026-03-02T00:00:00Z')
    const sha = (await git(dir, 'rev-parse', 'HEAD~1')).trim()

    expect(await subjects(dir, { search: 'author:Ada Lovelace' })).toEqual(['Written by Ada'])
    expect(await subjects(dir, { search: sha.slice(0, 10) })).toEqual(['Written by Ada'])
  }, 30000)
})

describe('branch search', () => {
  /** main, two feature branches and a hotfix branch with interleaved commits, plus two remote-tracking branches. */
  async function branchRepo(): Promise<string> {
    const dir = await initRepo(tempDir('gm-branch-'), { initialCommit: false })
    await commitAt(dir, 'base', '2026-04-01T00:00:00Z')
    for (const branch of ['feature/login', 'feature/signup', 'hotfix']) await git(dir, 'branch', branch)
    const steps: Array<[string, string, string]> = [
      ['feature/login', 'login form', '2026-04-02T00:00:00Z'],
      ['main', 'main work', '2026-04-03T00:00:00Z'],
      ['feature/signup', 'signup form', '2026-04-04T00:00:00Z'],
      ['feature/login', 'fix login bug', '2026-04-05T00:00:00Z'],
      ['hotfix', 'fix crash', '2026-04-06T00:00:00Z'],
      ['main', 'more main work', '2026-04-07T00:00:00Z']
    ]
    for (const [branch, message, date] of steps) {
      await git(dir, 'checkout', '-q', branch)
      await commitAt(dir, message, date)
    }
    await git(dir, 'checkout', '-q', 'main')
    await git(dir, 'update-ref', 'refs/remotes/origin/main', 'main~1')
    await git(dir, 'update-ref', 'refs/remotes/origin/feature/login', 'feature/login~1')
    return dir
  }

  it('limits history to the branches a pattern matches, page by page', async () => {
    const dir = await branchRepo()
    const expected = (
      await git(
        dir,
        'rev-list',
        '--date-order',
        'refs/heads/feature/login',
        'refs/heads/feature/signup',
        'refs/remotes/origin/feature/login'
      )
    )
      .trim()
      .split('\n')

    const seen: string[] = []
    for (let skip = 0; ; ) {
      const page = await loadHistory({ repoPath: dir, search: 'branch:feature/*', limit: 2, skip })
      expect(page.branches).toEqual(['feature/login', 'feature/signup', 'origin/feature/login'])
      seen.push(...page.commits.map((c) => c.sha))
      if (!page.nextCursor) break
      skip += page.commits.length
    }
    expect(seen).toEqual(expected)
  }, 30000)

  it('matches main exactly, with its remote-tracking branch, and combines with other search terms', async () => {
    const dir = await branchRepo()
    const main = await loadHistory({ repoPath: dir, search: 'branch:main', limit: 50 })
    expect(main.branches).toEqual(['main', 'origin/main'])
    expect(main.commits.map((c) => c.subject)).toEqual(['more main work', 'main work', 'base'])

    expect(await subjects(dir, { search: 'fix branch:feature/login' })).toEqual(['fix login bug'])
    expect(await subjects(dir, { search: 'branch:hotfix branch:signup' })).toEqual(['fix crash', 'signup form', 'base'])
    expect(await subjects(dir, { search: 'branch:feature/login author:Test User' })).toEqual([
      'fix login bug',
      'login form',
      'base'
    ])
  }, 30000)

  it('replaces the current-branch filter', async () => {
    const dir = await branchRepo()
    expect(await subjects(dir, { branch: 'main', search: 'branch:hotfix' })).toEqual(['fix crash', 'base'])
  }, 30000)

  it('says so when no branch matches', async () => {
    const dir = await branchRepo()
    const page = await loadHistory({ repoPath: dir, search: 'fix branch:nothing-here branch:nor-this', limit: 50 })
    expect(page).toMatchObject({ commits: [], nextCursor: null, branches: [] })
    expect(page.notice).toBe('No branch matches "nothing-here" or "nor-this".')
  }, 30000)

  it('passes any number of matching branches to Git', async () => {
    const dir = await initRepo(tempDir('gm-branch-many-'))
    const root = (await git(dir, 'rev-parse', 'HEAD')).trim()
    const tip = await importCommits(dir, { ref: 'refs/heads/topics', count: 2500, startEpoch: 1_900_000_000, from: root })
    const chain = (await git(dir, 'rev-list', '--reverse', `${root}..topics`)).trim().split('\n')
    // About 100 KB of ref names: far more than a Windows command line (32,767 characters) holds.
    const updates = chain
      .map((sha, i) => `create refs/heads/topic/${String(i).padStart(4, '0')}-with-a-longer-name ${sha}\n`)
      .join('')
    const created = await runGit({ cwd: dir, args: ['update-ref', '--stdin'], input: updates })
    expect(created.code).toBe(0)

    const page = await loadHistory({ repoPath: dir, search: 'branch:topic/*', limit: 500 })
    expect(page.branches).toHaveLength(2500)
    expect(page.commits).toHaveLength(500)
    expect(page.commits[0].sha).toBe(tip)
    expect(page.nextCursor).not.toBeNull()
  }, 60000)
})

describe('jump to a commit', () => {
  /** A root commit, a side branch `old` with one old commit, then `count` newer commits on main. */
  async function deepRepo(count: number): Promise<{ dir: string; old: string }> {
    const dir = await initRepo(tempDir('gm-reveal-'), { initialCommit: false })
    const root = await importCommits(dir, {
      ref: 'refs/heads/main',
      count: 1,
      startEpoch: 1_700_000_000,
      subject: () => 'root'
    })
    const old = await importCommits(dir, {
      ref: 'refs/heads/old',
      count: 1,
      startEpoch: 1_700_000_010,
      from: root,
      subject: () => 'old tip'
    })
    await importCommits(dir, { ref: 'refs/heads/main', count, startEpoch: 1_700_000_100, from: root })
    return { dir, old }
  }

  it('loads every commit down to one far below the first page, and one page more', async () => {
    const { dir, old } = await deepRepo(450)
    const page = await loadHistory({ repoPath: dir, limit: 50, revealSha: old })
    expect(page.revealed).toBe(true)
    expect(page.commits.findIndex((c) => c.sha === old)).toBe(450)
    // Only the root commit is left below it.
    expect(page.commits.slice(-2).map((c) => c.subject)).toEqual(['old tip', 'root'])
    expect(page.nextCursor).toBeNull()
    expect(page.graph).toHaveLength(page.commits.length)
  }, 30000)

  it('stops one page past the commit, and paging continues from there', async () => {
    const { dir } = await deepRepo(300)
    const target = (await git(dir, 'rev-parse', 'main~100')).trim()
    const page = await loadHistory({ repoPath: dir, limit: 50, revealSha: target })
    expect(page.revealed).toBe(true)
    expect(page.commits.findIndex((c) => c.sha === target)).toBe(100)
    expect(page.commits).toHaveLength(151)
    expect(page.nextCursor).toBe(page.commits[150].sha)

    const next = await loadHistory({ repoPath: dir, limit: 50, skip: page.commits.length })
    expect(next.commits[0].sha).toBe((await git(dir, 'rev-parse', 'main~151')).trim())
  }, 30000)

  it('reports a commit that the walk does not reach', async () => {
    const { dir, old } = await deepRepo(60)
    const page = await loadHistory({ repoPath: dir, limit: 50, branch: 'main', revealSha: old })
    expect(page.revealed).toBe(false)
    expect(page.commits).toHaveLength(50)
    expect(page.nextCursor).toBe(page.commits[49].sha)
  }, 30000)

  it('gives up after 10,000 commits', async () => {
    const { dir, old } = await deepRepo(10_050)
    const page = await loadHistory({ repoPath: dir, limit: 50, revealSha: old })
    expect(page.revealed).toBe(false)
    expect(page.commits).toHaveLength(50)
  }, 60000)
})
