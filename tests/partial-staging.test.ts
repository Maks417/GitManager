import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { applyPartial, getWorkingTreeDiff } from '../src/git-worker/operations'
import {
  buildPartialPatch,
  getDiffHunks,
  parseUnifiedDiff,
  STALE_DIFF_MESSAGE
} from '../src/git-worker/ops/patch'

const dirs: string[] = []

async function git(dir: string, ...args: string[]): Promise<string> {
  const result = await runGit({ cwd: dir, args })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout
}

const numbered = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i + 1}\n`).join('')

/** A repo with `file.txt` holding `content` committed. */
async function initRepo(content: string, config: string[][] = []): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-patch-'))
  dirs.push(dir)
  await git(dir, 'init')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'user.name', 'Test User')
  for (const [key, value] of config) await git(dir, 'config', key, value)
  writeFileSync(join(dir, 'file.txt'), content)
  await git(dir, 'add', 'file.txt')
  await git(dir, 'commit', '-m', 'initial')
  return dir
}

/** `line 1..20` with line 3 changed and line 17 removed: two hunks. */
function twoHunkEdit(): string {
  return numbered(20)
    .split('\n')
    .map((l) => (l === 'line 3' ? 'line 3 changed' : l))
    .filter((l) => l !== 'line 17')
    .join('\n')
}

const read = (dir: string): string => readFileSync(join(dir, 'file.txt'), 'utf8')
const indexText = (dir: string): Promise<string> => git(dir, 'show', ':file.txt')

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('parseUnifiedDiff', () => {
  it('numbers lines and keeps the no-newline marker', () => {
    const raw = [
      'diff --git a/f b/f',
      'index 1111111..2222222 100644',
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      ''
    ].join('\n')
    const parsed = parseUnifiedDiff(raw)
    expect(parsed?.header).toHaveLength(4)
    expect(parsed?.hunks[0].lines).toEqual([
      { kind: 'context', text: 'keep', noNewline: false, oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'old', noNewline: true, oldLine: 2, newLine: null },
      { kind: 'add', text: 'new', noNewline: true, oldLine: null, newLine: 2 }
    ])
  })

  it('refuses binary and combined diffs', () => {
    expect(parseUnifiedDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toBeNull()
    expect(parseUnifiedDiff('diff --cc f\n@@@ -1 -1 +1 @@@\n')).toBeNull()
  })
})

describe('buildPartialPatch', () => {
  const raw = [
    'diff --git a/f b/f',
    '--- a/f',
    '+++ b/f',
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    '@@ -10,3 +10,4 @@',
    ' x',
    '+y1',
    '+y2',
    ' z',
    '-w',
    ''
  ].join('\n')

  it('drops unselected additions and keeps unselected removals as context, forward', () => {
    const parsed = parseUnifiedDiff(raw)!
    const patch = buildPartialPatch(parsed, (l) => l.kind === 'add' && l.newLine === 11, false)
    expect(patch).toBe(['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -10,3 +10,4 @@', ' x', '+y1', ' z', ' w', ''].join('\n'))
  })

  it('shifts later hunks by the selected changes before them', () => {
    const parsed = parseUnifiedDiff(raw)!
    // Only the "-b" removal of hunk 0 (no "+B"), then all of hunk 1.
    const patch = buildPartialPatch(parsed, (l, h) => h === 1 || l.kind === 'del', false)!
    expect(patch).toContain('@@ -1,3 +1,2 @@\n a\n-b\n c\n')
    expect(patch).toContain('@@ -10,3 +9,4 @@\n x\n+y1\n+y2\n z\n-w\n')
  })

  it('keeps unselected additions as context and drops unselected removals, in reverse', () => {
    const parsed = parseUnifiedDiff(raw)!
    const patch = buildPartialPatch(parsed, (l) => l.kind === 'del' && l.oldLine === 2, true)!
    // Applied to the new side (a, B, c), it puts "b" back and keeps "B".
    expect(patch).toContain('@@ -1,4 +1,3 @@\n a\n-b\n B\n c\n')
    expect(patch).not.toContain('@@ -10')
  })

  it('returns null when nothing is selected', () => {
    expect(buildPartialPatch(parseUnifiedDiff(raw)!, () => false, false)).toBeNull()
  })
})

describe('applyPartial', () => {
  it('stages one hunk and leaves the other unstaged', async () => {
    const dir = await initRepo(numbered(20))
    writeFileSync(join(dir, 'file.txt'), twoHunkEdit())
    const hunks = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!
    expect(hunks.hunks).toHaveLength(2)

    await applyPartial(dir, {
      repoPath: dir,
      path: 'file.txt',
      side: 'unstaged',
      action: 'stage',
      fingerprint: hunks.fingerprint,
      selection: { hunk: 0 }
    })
    const index = await indexText(dir)
    expect(index).toContain('line 3 changed')
    expect(index).toContain('line 17')
    expect(read(dir)).toBe(twoHunkEdit())
  }, 30000)

  it('stages selected lines only', async () => {
    const dir = await initRepo(numbered(5))
    writeFileSync(join(dir, 'file.txt'), 'line 1\nnew A\nline 2\nnew B\nline 3\nline 4\nline 5\n')
    const hunks = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!

    await applyPartial(dir, {
      repoPath: dir,
      path: 'file.txt',
      side: 'unstaged',
      action: 'stage',
      fingerprint: hunks.fingerprint,
      selection: { oldLines: [], newLines: [4] }
    })
    expect(await indexText(dir)).toBe('line 1\nline 2\nnew B\nline 3\nline 4\nline 5\n')
  }, 30000)

  it('unstages a hunk from the index', async () => {
    const dir = await initRepo(numbered(20))
    writeFileSync(join(dir, 'file.txt'), twoHunkEdit())
    await git(dir, 'add', 'file.txt')
    const hunks = (await getDiffHunks(dir, 'file.txt', 'staged'))!

    await applyPartial(dir, {
      repoPath: dir,
      path: 'file.txt',
      side: 'staged',
      action: 'unstage',
      fingerprint: hunks.fingerprint,
      selection: { hunk: 1 }
    })
    const index = await indexText(dir)
    expect(index).toContain('line 3 changed')
    expect(index).toContain('line 17')
    expect(read(dir)).toBe(twoHunkEdit())
  }, 30000)

  it('discards selected lines from the work tree, keeping the rest', async () => {
    const dir = await initRepo(numbered(5))
    writeFileSync(join(dir, 'file.txt'), 'line 1\nnew A\nline 2\nline 3\nline 4\n')
    const hunks = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!

    // Put "line 5" back; keep "new A".
    await applyPartial(dir, {
      repoPath: dir,
      path: 'file.txt',
      side: 'unstaged',
      action: 'discard',
      fingerprint: hunks.fingerprint,
      selection: { oldLines: [5], newLines: [] }
    })
    expect(read(dir)).toBe('line 1\nnew A\nline 2\nline 3\nline 4\nline 5\n')
  }, 30000)

  it('handles files without a newline at the end', async () => {
    const dir = await initRepo('a\nb')
    writeFileSync(join(dir, 'file.txt'), 'a\nb\nc\nd')
    const hunks = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!
    const request = {
      repoPath: dir,
      path: 'file.txt',
      side: 'unstaged' as const,
      action: 'stage' as const,
      fingerprint: hunks.fingerprint
    }

    // "c" alone would follow a last line that has no newline in the index: Git refuses, and says what to do.
    await expect(applyPartial(dir, { ...request, selection: { oldLines: [], newLines: [3] } })).rejects.toThrow(
      /Include the lines next to them/
    )
    await applyPartial(dir, { ...request, selection: { oldLines: [2], newLines: [2, 3] } })
    expect(await indexText(dir)).toBe('a\nb\nc\n')
  }, 30000)

  it('refuses a stale fingerprint', async () => {
    const dir = await initRepo(numbered(5))
    writeFileSync(join(dir, 'file.txt'), 'line 1\nchanged\n')
    const hunks = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!
    writeFileSync(join(dir, 'file.txt'), 'line 1\nchanged again\n')

    await expect(
      applyPartial(dir, {
        repoPath: dir,
        path: 'file.txt',
        side: 'unstaged',
        action: 'stage',
        fingerprint: hunks.fingerprint,
        selection: { hunk: 0 }
      })
    ).rejects.toThrow(STALE_DIFF_MESSAGE)
  }, 30000)

  it('refuses an action that does not fit the side', async () => {
    const dir = await initRepo(numbered(5))
    await expect(
      applyPartial(dir, {
        repoPath: dir,
        path: 'file.txt',
        side: 'staged',
        action: 'stage',
        fingerprint: 'x',
        selection: { hunk: 0 }
      })
    ).rejects.toThrow(/Cannot stage staged/)
  }, 30000)

  it('works on CRLF work-tree files with core.autocrlf', async () => {
    const dir = await initRepo(numbered(20), [['core.autocrlf', 'true']])
    // Check the file out again with CRLF endings.
    rmSync(join(dir, 'file.txt'))
    await git(dir, 'checkout', '--', 'file.txt')
    const crlf = read(dir)
    const edited = crlf.replace('line 2\r\n', 'line 2 changed\r\n').replace('line 18\r\n', 'line 18 changed\r\n')
    writeFileSync(join(dir, 'file.txt'), edited)
    const hunks = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!

    await applyPartial(dir, {
      repoPath: dir,
      path: 'file.txt',
      side: 'unstaged',
      action: 'stage',
      fingerprint: hunks.fingerprint,
      selection: { hunk: 0 }
    })
    expect(await indexText(dir)).toContain('line 2 changed\n')
    expect(await indexText(dir)).not.toContain('line 18 changed')

    const fresh = (await getDiffHunks(dir, 'file.txt', 'unstaged'))!
    await applyPartial(dir, {
      repoPath: dir,
      path: 'file.txt',
      side: 'unstaged',
      action: 'discard',
      fingerprint: fresh.fingerprint,
      selection: { hunk: 0 }
    })
    const after = read(dir)
    expect(after).toContain('line 2 changed')
    expect(after).toContain('line 18\r\n')
  }, 30000)
})

describe('hunks in working-tree diffs', () => {
  it('are sent for modified text files', async () => {
    const dir = await initRepo(numbered(20))
    writeFileSync(join(dir, 'file.txt'), twoHunkEdit())
    const diff = await getWorkingTreeDiff(dir, 'file.txt', 'unstaged')
    expect(diff.hunks?.hunks.map((h) => h.newStart)).toEqual([1, 14])
  }, 30000)

  it('are not sent for new, binary or unchanged files', async () => {
    const dir = await initRepo(numbered(3))
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await git(dir, 'add', 'new.txt')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2]))
    await git(dir, 'add', 'bin.dat')
    await git(dir, 'commit', '-m', 'more')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 3]))
    writeFileSync(join(dir, 'other.txt'), 'untracked\n')

    expect((await getWorkingTreeDiff(dir, 'bin.dat', 'unstaged')).hunks).toBeUndefined()
    expect((await getWorkingTreeDiff(dir, 'other.txt', 'unstaged')).hunks).toBeUndefined()
    expect((await getWorkingTreeDiff(dir, 'new.txt', 'unstaged')).hunks).toBeUndefined()
  }, 30000)
})
