import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { loadHistory } from '../src/git-worker/operations'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

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

describe('ref decorations', () => {
  it('tells local branches with slashes, remote branches, tags and HEAD apart', async () => {
    const dir = await initRepo(tempDir('gm-refs-'))
    await git(dir, 'branch', 'feature/login')
    await git(dir, 'tag', 'v1.0')
    await git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

    const [commit] = (await loadHistory({ repoPath: dir, limit: 5 })).commits
    const refs = commit.refs.map(({ name, type }) => ({ name, type }))
    expect(refs).toEqual(
      expect.arrayContaining([
        { name: 'HEAD → main', type: 'head' },
        { name: 'feature/login', type: 'local' },
        { name: 'origin/main', type: 'remote' },
        { name: 'v1.0', type: 'tag' }
      ])
    )
  }, 30000)
})
