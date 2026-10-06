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
  locateRegions,
  parseConflictMarkers,
  resolutionText
} from '../src/merge-core/conflict'
import { baseLinePairs, mapLine, sideLinePairs } from '../src/renderer/src/logic/merge-scroll'
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
    // Each side's changes from the base, as line ranges in that side and in the base.
    expect(sides.oursChanges).toEqual([
      { side: { start: 1, end: 2 }, base: { start: 1, end: 2 } },
      { side: { start: 5, end: 6 }, base: { start: 5, end: 6 } }
    ])
    expect(sides.theirsChanges).toEqual([
      { side: { start: 5, end: 6 }, base: { start: 5, end: 6 } },
      { side: { start: 9, end: 10 }, base: { start: 9, end: 10 } }
    ])

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
    const sides = await getMergeSides(dir, 'keep.txt')
    expect(sides.oursChanges).toEqual([])
    expect(sides.theirsChanges).toEqual([{ side: { start: 1, end: 2 }, base: { start: 1, end: 2 } }])
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

describe('conflict regions', () => {
  const diff3 = [
    'top',
    '<<<<<<< HEAD',
    'ours 1',
    'ours 2',
    '||||||| merged common ancestors',
    'base',
    '=======',
    'theirs',
    '>>>>>>> feature/login',
    'bottom'
  ].join('\n')

  it('keeps the marker labels and where each side sits in the text', () => {
    const [region] = parseConflictMarkers(diff3)
    expect(region).toMatchObject({
      startLine: 1,
      endLine: 8,
      oursLabel: 'HEAD',
      theirsLabel: 'feature/login',
      oursLines: { start: 2, end: 4 },
      baseLines: { start: 5, end: 6 },
      theirsLines: { start: 7, end: 8 },
      base: 'base'
    })
  })

  it('puts both sides in either order', () => {
    const [region] = parseConflictMarkers(diff3)
    expect(resolutionText(region, 'both')).toBe('ours 1\nours 2\ntheirs')
    expect(resolutionText(region, 'both-theirs-first')).toBe('theirs\nours 1\nours 2')
  })

  it('finds each region in the side files, in order, even when a block repeats', () => {
    const result = ['a', '<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> b', 'm', '<<<<<<< HEAD', 'x', '=======', 'z', '>>>>>>> b', ''].join('\n')
    const ours = ['a', 'x', 'm', 'x', ''].join('\n')
    const theirs = ['a', 'y', 'm', 'z', ''].join('\n')
    const regions = parseConflictMarkers(result)
    expect(locateRegions(result, regions, ours, theirs)).toEqual([
      { ours: { start: 2, end: 3 }, theirs: { start: 2, end: 3 } },
      { ours: { start: 4, end: 5 }, theirs: { start: 4, end: 5 } }
    ])
  })

  it('places a side that removed the lines after the line above the conflict', () => {
    const result = ['a', 'b', '<<<<<<< HEAD', '=======', 'theirs', '>>>>>>> t', 'c', ''].join('\r\n')
    const regions = parseConflictMarkers(result)
    const [anchor] = locateRegions(result, regions, 'a\r\nb\r\nc\r\n', 'a\r\nb\r\ntheirs\r\nc\r\n')
    expect(anchor.ours).toEqual({ start: 3, end: 3 })
    expect(anchor.theirs).toEqual({ start: 3, end: 4 })
  })
})

describe('merge pane scrolling', () => {
  it('lines up each conflict with its block in the side and spreads the lines between', () => {
    // Result: 2 lines, a 5-line conflict (ours 1 line, theirs 1 line), then 2 lines.
    const result = ['a', 'b', '<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> t', 'c', 'd'].join('\n')
    const regions = parseConflictMarkers(result)
    const anchors = locateRegions(result, regions, 'a\nb\nx\nc\nd', 'a\nb\ny\nc\nd')
    const pairs = sideLinePairs(regions, anchors, 'ours', 9, 5)
    expect(mapLine(pairs, 1)).toBe(1)
    expect(mapLine(pairs, 4)).toBe(3) // ours' line in the conflict
    expect(mapLine(pairs, 6)).toBe(4) // theirs' part of the conflict faces the line after ours' block
    expect(mapLine(pairs, 8)).toBe(4)
    expect(mapLine(pairs, 9)).toBe(5)
    expect(mapLine(pairs, 3.5, true)).toBe(4.5) // halfway through ours' line, halfway through its text in the result
    expect(mapLine(pairs, 4, true)).toBe(5) // the first result line facing it wins
  })

  it('maps side lines to the base through the blocks the side changed', () => {
    // The side replaced base lines 3-4 with one line 3.
    const pairs = baseLinePairs([{ side: { start: 3, end: 4 }, base: { start: 3, end: 5 } }], 6, 7)
    expect(mapLine(pairs, 2)).toBe(2)
    expect(mapLine(pairs, 4)).toBe(5)
    expect(mapLine(pairs, 6)).toBe(7)
  })
})
