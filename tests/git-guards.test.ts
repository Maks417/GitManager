import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  checkoutRef,
  createBranch,
  deleteBranch,
  getFileDiff,
  getWorkingTreeDiff,
  loadHistory,
  mergeRef,
  rebaseOnto,
  saveMergeResult,
  stashApply
} from '../src/git-worker/operations'
import {
  PathsArraySchema,
  RefSchema,
  RepoRelativePathSchema,
  StashRefSchema
} from '../src/main/ipc/parse'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('git op argument guards', () => {
  it('rejects option-like values before they reach git', async () => {
    const dir = await initRepo(tempDir('gm-guard-'))
    const marker = join(dir, 'pwned.txt')

    await expect(rebaseOnto(dir, `--exec=git commit --allow-empty -m pwned`)).rejects.toThrow(
      /Invalid reference/
    )
    await expect(mergeRef(dir, '--help')).rejects.toThrow(/Invalid reference/)
    await expect(createBranch(dir, '-D', false)).rejects.toThrow(/Invalid branch name/)
    await expect(deleteBranch(dir, '--force', false)).rejects.toThrow(/Invalid branch name/)
    await expect(
      loadHistory({ repoPath: dir, branch: `--output=${marker}`, limit: 5 })
    ).rejects.toThrow(/Invalid branch/)
    await expect(getFileDiff(dir, `--output=${marker}`, 'README.md')).rejects.toThrow(/Invalid commit id/)
    await expect(stashApply(dir, '--index')).rejects.toThrow(/Invalid stash reference/)

    expect(existsSync(marker)).toBe(false)
    expect((await git(dir, 'rev-list', '--count', 'HEAD')).trim()).toBe('1')
  }, 30000)

  it('checks out only real refs and never restores same-named paths', async () => {
    const dir = await initRepo(tempDir('gm-guard-'))
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'guide.md'), 'v1\n')
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-m', 'docs')
    writeFileSync(join(dir, 'docs', 'guide.md'), 'uncommitted edit\n')

    await expect(checkoutRef(dir, 'docs')).rejects.toThrow(/invalid reference/i)
    expect(readFileSync(join(dir, 'docs', 'guide.md'), 'utf8')).toBe('uncommitted edit\n')
  }, 30000)

  it('keeps work-tree reads and writes inside the repository', async () => {
    const dir = await initRepo(tempDir('gm-guard-'))
    await expect(getWorkingTreeDiff(dir, '../outside.txt', 'unstaged')).rejects.toThrow(
      /outside the repository/
    )
    await expect(getWorkingTreeDiff(dir, join(tmpdir(), 'x.txt'), 'unstaged')).rejects.toThrow(
      /Invalid repository path/
    )
    await expect(getFileDiff(dir, 'a'.repeat(40), '../x')).rejects.toThrow(/outside the repository/)
  }, 30000)

  it.skipIf(process.platform === 'win32')('does not follow symlinks out of the repository', async () => {
    const dir = await initRepo(tempDir('gm-guard-'))
    const outside = tempDir('gm-outside-')
    symlinkSync(outside, join(dir, 'linked-dir'))
    writeFileSync(join(outside, 'target.txt'), 'secret\n')
    symlinkSync(join(outside, 'target.txt'), join(dir, 'linked-file'))

    await expect(saveMergeResult(dir, 'linked-dir/evil.txt', 'x')).rejects.toThrow(/outside the repository/)
    await expect(saveMergeResult(dir, 'linked-file', 'x')).rejects.toThrow(/symbolic link/)
    await expect(getWorkingTreeDiff(dir, 'linked-dir/target.txt', 'unstaged')).rejects.toThrow(
      /outside the repository/
    )
    // Like Git, a symlink's content is its target path, never the file it points to.
    const diff = await getWorkingTreeDiff(dir, 'linked-file', 'unstaged')
    expect(diff.newText).toBe(join(outside, 'target.txt'))
    expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe('secret\n')
  }, 30000)
})

describe('IPC input schemas', () => {
  it('validates refs, stash refs and repository-relative paths', () => {
    expect(RefSchema.safeParse('feature/login').success).toBe(true)
    expect(RefSchema.safeParse('--exec=calc').success).toBe(false)
    expect(RefSchema.safeParse('main\n--x').success).toBe(false)
    expect(StashRefSchema.safeParse('stash@{2}').success).toBe(true)
    expect(StashRefSchema.safeParse('--index').success).toBe(false)
    expect(RepoRelativePathSchema.safeParse('src/app.ts').success).toBe(true)
    expect(RepoRelativePathSchema.safeParse('..hidden/file').success).toBe(true)
    expect(RepoRelativePathSchema.safeParse('../secret').success).toBe(false)
    expect(RepoRelativePathSchema.safeParse('a/../../secret').success).toBe(false)
    expect(RepoRelativePathSchema.safeParse('/etc/passwd').success).toBe(false)
    expect(RepoRelativePathSchema.safeParse('C:\\Windows\\win.ini').success).toBe(false)
    expect(PathsArraySchema.safeParse(['ok.txt', '../nope']).success).toBe(false)
  })
})
