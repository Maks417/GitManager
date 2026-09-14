import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  getMergeSides,
  listConflictFiles,
  resolveConflictSide,
  saveMergeResult
} from '../src/git-worker/operations'
import {
  applyRegionResolution,
  hasUnresolvedMarkers,
  parseConflictMarkers
} from '../src/merge-core/conflict'
import { initRepo, mergeWithConflicts, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('merge conflict resolution against real git', () => {
  it("starts from Git's merge so non-overlapping changes from both sides survive", async () => {
    const dir = await initRepo(tempDir('gm-merge-'), { initialCommit: false })
    await mergeWithConflicts(dir, {
      base: { 'text.txt': 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n' },
      theirs: { 'text.txt': 'l1\nl2\nl3\nl4\nl5-theirs\nl6\nl7\nl8\nl9-theirs\n' },
      ours: { 'text.txt': 'l1-ours\nl2\nl3\nl4\nl5-ours\nl6\nl7\nl8\nl9\n' }
    })

    const sides = await getMergeSides(dir, 'text.txt')
    expect(sides).toMatchObject({ binary: false, tooLarge: false })
    expect(sides.ours).toContain('l5-ours')
    expect(sides.theirs).toContain('l5-theirs')
    expect(sides.result).toContain('l1-ours')
    expect(sides.result).toContain('l9-theirs')

    const regions = parseConflictMarkers(sides.result)
    expect(regions).toHaveLength(1)
    const resolved = applyRegionResolution(sides.result, regions[0], 'ours').text
    expect(hasUnresolvedMarkers(resolved)).toBe(false)
    expect(resolved).toBe('l1-ours\nl2\nl3\nl4\nl5-ours\nl6\nl7\nl8\nl9-theirs\n')

    await saveMergeResult(dir, 'text.txt', resolved)
    expect(await listConflictFiles(dir)).toEqual([])
    expect(readFileSync(join(dir, 'text.txt'), 'utf8')).toBe(resolved)
  }, 30000)

  it('resolves binary conflicts by taking a whole side', async () => {
    const dir = await initRepo(tempDir('gm-merge-'), { initialCommit: false })
    await mergeWithConflicts(dir, {
      base: { 'bin.dat': Buffer.from([0, 1, 2]) },
      theirs: { 'bin.dat': Buffer.from([0, 9, 9, 9]) },
      ours: { 'bin.dat': Buffer.from([0, 7, 7]) }
    })

    const sides = await getMergeSides(dir, 'bin.dat')
    expect(sides.binary).toBe(true)
    expect(sides.result).toBe('')

    await resolveConflictSide(dir, 'bin.dat', 'theirs')
    expect(readFileSync(join(dir, 'bin.dat'))).toEqual(Buffer.from([0, 9, 9, 9]))
    expect(await listConflictFiles(dir)).toEqual([])
  }, 30000)

  it('resolves a modify/delete conflict as a deletion when the deleting side is taken', async () => {
    const dir = await initRepo(tempDir('gm-merge-'), { initialCommit: false })
    await mergeWithConflicts(dir, {
      base: { 'keep.txt': 'keep\n', 'other.txt': 'other\n' },
      theirs: { 'keep.txt': 'changed by theirs\n' },
      ours: { 'keep.txt': null }
    })

    expect(await listConflictFiles(dir)).toEqual([
      { path: 'keep.txt', hasBase: true, hasOurs: false, hasTheirs: true }
    ])
    await resolveConflictSide(dir, 'keep.txt', 'ours')
    expect(existsSync(join(dir, 'keep.txt'))).toBe(false)
    expect(await listConflictFiles(dir)).toEqual([])
  }, 30000)

  it('refuses paths outside the repository', async () => {
    const dir = await initRepo(tempDir('gm-merge-'))
    const escape = `../gm-escape-${Date.now()}.txt`
    await expect(saveMergeResult(dir, escape, 'x')).rejects.toThrow(/outside the repository/)
    await expect(getMergeSides(dir, escape)).rejects.toThrow(/outside the repository/)
    await expect(resolveConflictSide(dir, escape, 'ours')).rejects.toThrow(/outside the repository/)
    expect(existsSync(join(dir, escape))).toBe(false)
  }, 30000)
})

describe('conflict region edits', () => {
  it('keeps CRLF line endings when resolving a region', () => {
    const text = ['a', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch', 'z', ''].join('\r\n')
    const [region] = parseConflictMarkers(text)
    expect(applyRegionResolution(text, region, 'theirs').text).toBe('a\r\ntheirs\r\nz\r\n')
  })
})
