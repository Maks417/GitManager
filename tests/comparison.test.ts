import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { compareRefs, getComparisonDiff } from '../src/git-worker/operations'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const temp = trackTempDirs()

describe('reference comparison', () => {
  it('distinguishes feature changes since divergence from exact snapshot differences', async () => {
    const repo = await initRepo(temp('gm-compare-'))
    const common = (await git(repo, 'rev-parse', 'HEAD')).trim()
    await git(repo, 'checkout', '-b', 'feature')
    writeFileSync(join(repo, 'feature.txt'), 'new line\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'feature')
    await git(repo, 'checkout', 'main')
    writeFileSync(join(repo, 'main.txt'), 'main only\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'main')
    const review = await compareRefs(repo, { repoPath: repo, base: 'main', target: 'feature', mergeBase: true })
    expect(review.baseSha).toBe(common)
    expect(review.files.map((file) => file.path)).toEqual(['feature.txt'])
    expect(review.additions).toBe(1)
    const exact = await compareRefs(repo, { repoPath: repo, base: 'main', target: 'feature', mergeBase: false })
    expect(exact.files.map((file) => [file.path, file.status])).toEqual([['feature.txt', 'added'], ['main.txt', 'deleted']])
    expect(exact.deletions).toBe(1)
    const diff = await getComparisonDiff(repo, { repoPath: repo, baseSha: review.baseSha, targetSha: review.targetSha, path: 'feature.txt' })
    expect(diff.oldText).toBe('')
    expect(diff.newText).toBe('new line\n')
    await expect(compareRefs(repo, { repoPath: repo, base: '--output=bad', target: 'HEAD' })).rejects.toThrow(/Invalid reference/)
    await expect(compareRefs(repo, { repoPath: repo, base: 'missing', target: 'HEAD' })).rejects.toThrow(/not found/)
  }, 30000)

  it('handles renamed Unicode paths and binary file statistics', async () => {
    const repo = await initRepo(temp('gm-compare-rename-'))
    const base = (await git(repo, 'rev-parse', 'HEAD')).trim()
    await git(repo, 'mv', 'README.md', 'renamed 文档.md')
    writeFileSync(join(repo, 'binary.dat'), Buffer.from([0, 1, 2, 3]))
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'rename and binary')
    const result = await compareRefs(repo, { repoPath: repo, base, target: 'HEAD', mergeBase: false })
    const renamed = result.files.find((file) => file.status === 'renamed')!
    expect(renamed.oldPath).toBe('README.md')
    expect(renamed.path).toBe('renamed 文档.md')
    expect(result.binaryFiles).toBe(1)
    expect(result.additions).toBe(0)
    const diff = await getComparisonDiff(repo, { repoPath: repo, baseSha: result.baseSha, targetSha: result.targetSha, path: renamed.path, oldPath: renamed.oldPath })
    expect(diff.oldText).toBe('# repo\n')
    expect(diff.newText).toBe('# repo\n')
  })
})
