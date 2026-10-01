import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import {
  cherryPickCommit,
  countCommitsAfter,
  createBranch,
  createTag,
  deleteTag,
  getSequencerOp,
  pushTag,
  resetToCommit,
  revertCommit,
  sequencerStep
} from '../src/git-worker/operations'

const dirs: string[] = []

async function git(dir: string, ...args: string[]): Promise<string> {
  const result = await runGit({ cwd: dir, args })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, file), content)
  await git(dir, 'add', file)
  await git(dir, 'commit', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

/** main: base → A. side (from base): B changes other.txt, C changes file.txt in a way that conflicts with A. */
async function initRepo(): Promise<{ dir: string; base: string; a: string; b: string; c: string }> {
  const dir = tempDir('gm-commits-')
  await git(dir, 'init', '-b', 'main')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'user.name', 'Test User')
  const base = await commitFile(dir, 'file.txt', 'one\n', 'base')
  const a = await commitFile(dir, 'file.txt', 'one from main\n', 'A')
  await git(dir, 'checkout', '-b', 'side', base)
  const b = await commitFile(dir, 'other.txt', 'other\n', 'B')
  const c = await commitFile(dir, 'file.txt', 'one from side\n', 'C')
  await git(dir, 'checkout', 'main')
  return { dir, base, a, b, c }
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('cherry-pick', () => {
  it('applies a commit cleanly', async () => {
    const { dir, b } = await initRepo()
    expect(await cherryPickCommit(dir, b)).toEqual({ conflicts: [] })
    expect(read(dir, 'other.txt')).toBe('other\n')
    expect(await git(dir, 'log', '-1', '--format=%s')).toBe('B')
    expect(await getSequencerOp(dir)).toBeNull()
  }, 30000)

  it('stops on conflicts, then continues once they are resolved', async () => {
    const { dir, c } = await initRepo()
    expect(await cherryPickCommit(dir, c)).toEqual({ conflicts: ['file.txt'] })
    expect(await getSequencerOp(dir)).toBe('cherry-pick')

    writeFileSync(join(dir, 'file.txt'), 'resolved\n')
    await git(dir, 'add', 'file.txt')
    expect(await sequencerStep(dir, 'continue')).toEqual({ conflicts: [] })
    expect(await getSequencerOp(dir)).toBeNull()
    expect(await git(dir, 'log', '-1', '--format=%s')).toBe('C')
  }, 30000)

  it('aborts back to where it started', async () => {
    const { dir, a, c } = await initRepo()
    await cherryPickCommit(dir, c)
    await sequencerStep(dir, 'abort')
    expect(await getSequencerOp(dir)).toBeNull()
    expect(await git(dir, 'rev-parse', 'HEAD')).toBe(a)
    expect(read(dir, 'file.txt')).toBe('one from main\n')
  }, 30000)

  it('picks a merge commit against its first parent', async () => {
    const { dir, base } = await initRepo()
    await git(dir, 'checkout', '-b', 'topic', base)
    await commitFile(dir, 'topic.txt', 'topic\n', 'T')
    await git(dir, 'checkout', '-b', 'merged', base)
    await commitFile(dir, 'merged.txt', 'm\n', 'M0')
    await git(dir, 'merge', '--no-edit', '--no-ff', 'topic')
    const merge = await git(dir, 'rev-parse', 'HEAD')
    await git(dir, 'checkout', 'main')

    expect(await cherryPickCommit(dir, merge)).toEqual({ conflicts: [] })
    expect(read(dir, 'topic.txt')).toBe('topic\n')
  }, 30000)
})

describe('revert', () => {
  it('adds a commit undoing the picked one', async () => {
    const { dir, a } = await initRepo()
    expect(await revertCommit(dir, a)).toEqual({ conflicts: [] })
    expect(read(dir, 'file.txt')).toBe('one\n')
    expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Revert "A"')
  }, 30000)

  it('reports a revert that stopped on conflicts', async () => {
    const { dir, a } = await initRepo()
    await commitFile(dir, 'file.txt', 'later change\n', 'D')
    expect(await revertCommit(dir, a)).toEqual({ conflicts: ['file.txt'] })
    expect(await getSequencerOp(dir)).toBe('revert')
    await sequencerStep(dir, 'abort')
    expect(await getSequencerOp(dir)).toBeNull()
  }, 30000)
})

describe('reset', () => {
  it('moves the branch and keeps or drops changes per mode', async () => {
    const { dir, base, a } = await initRepo()
    expect(await countCommitsAfter(dir, base)).toBe(1)

    await resetToCommit(dir, base, 'soft')
    expect(await git(dir, 'rev-parse', 'HEAD')).toBe(base)
    expect(await git(dir, 'diff', '--cached', '--name-only')).toBe('file.txt')

    await resetToCommit(dir, a, 'hard')
    await resetToCommit(dir, base, 'mixed')
    expect(await git(dir, 'diff', '--cached', '--name-only')).toBe('')
    expect(read(dir, 'file.txt')).toBe('one from main\n')

    await resetToCommit(dir, base, 'hard')
    expect(read(dir, 'file.txt')).toBe('one\n')
  }, 30000)

  it('accepts only commit ids', async () => {
    const { dir } = await initRepo()
    await expect(resetToCommit(dir, '--hard', 'hard')).rejects.toThrow(/Invalid commit id/)
  }, 30000)
})

describe('branches and tags at a commit', () => {
  it('creates a branch at a commit, with or without checking it out', async () => {
    const { dir, base } = await initRepo()
    await createBranch(dir, 'at-base', false, base)
    expect(await git(dir, 'rev-parse', 'at-base')).toBe(base)
    expect(await git(dir, 'branch', '--show-current')).toBe('main')
    await createBranch(dir, 'at-base-2', true, base)
    expect(await git(dir, 'branch', '--show-current')).toBe('at-base-2')
  }, 30000)

  it('creates lightweight and annotated tags, and deletes them', async () => {
    const { dir, base, a } = await initRepo()
    await createTag(dir, 'v1.0.0', base)
    await createTag(dir, 'v1.1.0', a, 'Release 1.1')
    expect(await git(dir, 'cat-file', '-t', 'v1.0.0')).toBe('commit')
    expect(await git(dir, 'cat-file', '-t', 'v1.1.0')).toBe('tag')
    await expect(createTag(dir, 'v1.0.0', a)).rejects.toThrow(/already exists/)
    await expect(createTag(dir, 'bad..name', a)).rejects.toThrow(/not a valid tag name/)

    await deleteTag(dir, 'v1.0.0')
    expect((await runGit({ cwd: dir, args: ['rev-parse', '-q', '--verify', 'refs/tags/v1.0.0'] })).code).not.toBe(0)
  }, 30000)

  it('pushes a tag to the remote and deletes it there', async () => {
    const { dir, a } = await initRepo()
    const remote = tempDir('gm-remote-')
    await git(remote, 'init', '--bare')
    await git(dir, 'remote', 'add', 'origin', remote)
    await createTag(dir, 'v2', a)

    expect(await pushTag(dir, 'v2', false)).toEqual({ outcome: 'done' })
    expect(await git(remote, 'rev-parse', 'v2')).toBe(a)

    expect(await pushTag(dir, 'v2', true)).toEqual({ outcome: 'done' })
    expect((await runGit({ cwd: remote, args: ['rev-parse', '-q', '--verify', 'refs/tags/v2'] })).code).not.toBe(0)
  }, 30000)
})
