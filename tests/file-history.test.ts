import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { getBlame, getFileHistory } from '../src/git-worker/operations'
import { FILE_HISTORY_PAGE_SIZE } from '../src/git-worker/ops/file-history'

const dirs: string[] = []

async function git(dir: string, ...args: string[]): Promise<string> {
  const result = await runGit({ cwd: dir, args })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

/** old.txt: one, two; renamed to new.txt in three; line 2 changed in four. */
async function initRepo(): Promise<{ dir: string; shas: Record<string, string> }> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-filehist-'))
  dirs.push(dir)
  await git(dir, 'init', '-b', 'main')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'user.name', 'Test User')
  await git(dir, 'config', 'core.autocrlf', 'false')
  const shas: Record<string, string> = {}
  const commit = async (subject: string): Promise<void> => {
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-m', subject)
    shas[subject] = await git(dir, 'rev-parse', 'HEAD')
  }
  writeFileSync(join(dir, 'old.txt'), 'a\nb\nc\n')
  writeFileSync(join(dir, 'other.txt'), 'x\n')
  await commit('one')
  writeFileSync(join(dir, 'old.txt'), 'a\nb\nc\nd\n')
  await commit('two')
  await git(dir, 'mv', 'old.txt', 'new.txt')
  await commit('three')
  writeFileSync(join(dir, 'new.txt'), 'a\nB\nc\nd\n')
  await commit('four')
  writeFileSync(join(dir, 'other.txt'), 'y\n')
  await commit('five')
  return { dir, shas }
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('getFileHistory', () => {
  it('lists the commits that changed a file, back through its rename', async () => {
    const { dir, shas } = await initRepo()
    const page = await getFileHistory(dir, 'new.txt')
    expect(page.hasMore).toBe(false)
    expect(page.entries.map((e) => [e.subject, e.path, e.status, e.oldPath])).toEqual([
      ['four', 'new.txt', 'modified', undefined],
      ['three', 'new.txt', 'renamed', 'old.txt'],
      ['two', 'old.txt', 'modified', undefined],
      ['one', 'old.txt', 'added', undefined]
    ])
    expect(page.entries[0].sha).toBe(shas.four)
    expect(page.entries[0].authorName).toBe('Test User')
  }, 30000)

  it('pages through long histories', async () => {
    const { dir } = await initRepo()
    for (let i = 0; i < FILE_HISTORY_PAGE_SIZE + 3; i++) {
      writeFileSync(join(dir, 'other.txt'), `${i}\n`)
      await git(dir, 'commit', '-qam', `other ${i}`)
    }
    const first = await getFileHistory(dir, 'other.txt')
    expect(first.entries).toHaveLength(FILE_HISTORY_PAGE_SIZE)
    expect(first.hasMore).toBe(true)
    const second = await getFileHistory(dir, 'other.txt', FILE_HISTORY_PAGE_SIZE)
    expect(second.entries.map((e) => e.subject)).toEqual(['other 2', 'other 1', 'other 0', 'five', 'one'])
    expect(second.hasMore).toBe(false)
  }, 60000)

  it('is empty for a path with no history', async () => {
    const { dir } = await initRepo()
    expect(await getFileHistory(dir, 'missing.txt')).toEqual({ entries: [], hasMore: false })
  }, 30000)
})

describe('getBlame', () => {
  it('groups lines by the commit that last changed them, and links to the commit before', async () => {
    const { dir, shas } = await initRepo()
    const blame = await getBlame(dir, 'new.txt')
    expect(blame.text).toBe('a\nB\nc\nd')
    expect(blame.groups).toEqual([
      { sha: shas.one, startLine: 1, lineCount: 1 },
      { sha: shas.four, startLine: 2, lineCount: 1 },
      { sha: shas.one, startLine: 3, lineCount: 1 },
      { sha: shas.two, startLine: 4, lineCount: 1 }
    ])
    const four = blame.commits[shas.four]
    expect(four.summary).toBe('four')
    expect(four.author).toBe('Test User')
    expect(four.uncommitted).toBe(false)
    expect(Number.isNaN(Date.parse(four.authoredAt))).toBe(false)
    expect([four.previousSha, four.previousPath]).toEqual([shas.three, 'new.txt'])
    expect(blame.commits[shas.two].previousPath).toBe('old.txt')
  }, 30000)

  it('marks uncommitted lines in the work tree', async () => {
    const { dir } = await initRepo()
    writeFileSync(join(dir, 'new.txt'), 'a\nB\nc\nd\nnew line\n')
    const blame = await getBlame(dir, 'new.txt')
    const last = blame.groups[blame.groups.length - 1]
    expect(last.startLine).toBe(5)
    expect(blame.commits[last.sha].uncommitted).toBe(true)
  }, 30000)

  it('blames at a commit', async () => {
    const { dir, shas } = await initRepo()
    const blame = await getBlame(dir, 'old.txt', shas.two)
    expect(blame.rev).toBe(shas.two)
    expect(blame.text).toBe('a\nb\nc\nd')
    expect(blame.groups.map((g) => g.sha)).toEqual([shas.one, shas.two])
  }, 30000)

  it('explains binary, uncommitted and missing files', async () => {
    const { dir } = await initRepo()
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2]))
    await git(dir, 'add', 'bin.dat')
    await git(dir, 'commit', '-m', 'bin')
    await expect(getBlame(dir, 'bin.dat')).rejects.toThrow(/binary/)
    writeFileSync(join(dir, 'untracked.txt'), 'u\n')
    await expect(getBlame(dir, 'untracked.txt')).rejects.toThrow(/not committed yet/)
    await expect(getBlame(dir, 'gone.txt')).rejects.toThrow(/does not exist/)
  }, 30000)
})
