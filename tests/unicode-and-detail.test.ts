import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runGit, runGitDelimited } from '../src/git-worker/git-runner'
import {
  getCommitDetail,
  getFileDiff,
  getMergeSides,
  getStatus,
  listConflictFiles,
  loadHistory
} from '../src/git-worker/operations'
import { git, initRepo, mergeWithConflicts, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('non-ASCII output', () => {
  it('decodes multi-byte characters split across pipe chunks', async () => {
    const dir = await initRepo(tempDir('gm-utf8-'))
    // ~1.3 MB of 2-, 3- and 4-byte characters guarantees chunk boundaries inside characters.
    const body = 'Привет, мир — 你好 🌍\n'.repeat(40_000).trim()
    writeFileSync(join(dir, 'msg.txt'), `Заголовок\n\n${body}\n`)
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    await git(dir, 'add', 'a.txt')
    await git(dir, 'commit', '-F', 'msg.txt')

    const plain = await runGit({ cwd: dir, args: ['log', '-1', '--format=%b'] })
    expect(plain.stdout.includes('�')).toBe(false)
    expect(plain.stdout.trim()).toBe(body)

    const delimited = await runGitDelimited({
      cwd: dir,
      args: ['log', '-1', '--format=%b%x1e'],
      delimiter: '\x1e'
    })
    expect(delimited.records[0].trim()).toBe(body)
  }, 60000)

  it('keeps Cyrillic file names intact in history, detail, diff and status', async () => {
    const dir = await initRepo(tempDir('gm-utf8-'))
    const name = 'документы/отчёт.txt'
    mkdirSync(join(dir, 'документы'))
    writeFileSync(join(dir, name), 'первая версия\n')
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-m', 'добавить отчёт')
    writeFileSync(join(dir, name), 'вторая версия\n')
    await git(dir, 'commit', '-am', 'обновить отчёт')

    const page = await loadHistory({ repoPath: dir, limit: 10 })
    expect(page.commits[0].subject).toBe('обновить отчёт')
    const detail = await getCommitDetail(dir, page.commits[0].sha)
    expect(detail.files).toEqual([{ path: name, status: 'modified' }])
    const diff = await getFileDiff(dir, page.commits[0].sha, name)
    expect(diff.oldText).toBe('первая версия\n')
    expect(diff.newText).toBe('вторая версия\n')

    writeFileSync(join(dir, name), 'третья версия\n')
    expect((await getStatus(dir)).map((s) => s.path)).toEqual([name])
  }, 30000)

  it('reports Cyrillic conflict paths without quoting', async () => {
    const dir = await initRepo(tempDir('gm-utf8-'), { initialCommit: false })
    await mergeWithConflicts(dir, {
      base: { 'файл.txt': 'база\n' },
      theirs: { 'файл.txt': 'их\n' },
      ours: { 'файл.txt': 'наш\n' }
    })
    expect((await listConflictFiles(dir)).map((c) => c.path)).toEqual(['файл.txt'])
    expect((await getMergeSides(dir, 'файл.txt')).theirs).toBe('их\n')
  }, 30000)
})

describe('commit detail', () => {
  it('lists the files of the root commit', async () => {
    const dir = await initRepo(tempDir('gm-detail-'))
    const page = await loadHistory({ repoPath: dir, limit: 5 })
    const detail = await getCommitDetail(dir, page.commits[0].sha)
    expect(detail.files).toEqual([{ path: 'README.md', status: 'added' }])
  }, 30000)

  it('reports renames with their old path and diffs against it', async () => {
    const dir = await initRepo(tempDir('gm-detail-'))
    await git(dir, 'mv', 'README.md', 'GUIDE.md')
    await git(dir, 'commit', '-m', 'rename')
    const sha = (await git(dir, 'rev-parse', 'HEAD')).trim()

    const detail = await getCommitDetail(dir, sha)
    expect(detail.files).toEqual([{ path: 'GUIDE.md', oldPath: 'README.md', status: 'renamed' }])
    const diff = await getFileDiff(dir, sha, 'GUIDE.md', 0, 'README.md')
    expect(diff.oldText).toBe('# repo\n')
    expect(diff.newText).toBe('# repo\n')
  }, 30000)
})
