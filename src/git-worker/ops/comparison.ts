import type { CompareDiffRequest, CompareRequest, Comparison } from '@shared/ipc'
import { assertRevision, assertSha } from './guards'
import { getTreeFileDiff, parseNameStatusZ } from './history'
import { gitOk, runGit } from './shared'

async function resolveCommit(repoPath: string, ref: string): Promise<string> {
  assertRevision(ref)
  const result = await runGit({ cwd: repoPath, args: ['rev-parse', '--verify', `${ref}^{commit}`] })
  if (result.code !== 0) throw new Error(`Commit or reference not found: ${ref}`)
  return assertSha(result.stdout.trim())
}

export async function compareRefs(repoPath: string, request: CompareRequest): Promise<Comparison> {
  assertRevision(request.base)
  assertRevision(request.target)
  // Finish both reads even when one fails, so no process still holds the repository after rejection.
  const resolved = await Promise.allSettled([
    resolveCommit(repoPath, request.base), resolveCommit(repoPath, request.target)
  ])
  const failure = resolved.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  const [base, targetSha] = resolved.map((result) => (result as PromiseFulfilledResult<string>).value)
  let baseSha = base
  if (request.mergeBase !== false) {
    const result = await runGit({ cwd: repoPath, args: ['merge-base', base, targetSha] })
    if (result.code !== 0) throw new Error('These references have no common ancestor. Turn off “Changes since common ancestor” to compare their snapshots.')
    baseSha = assertSha(result.stdout.trim())
  }
  const args = ['diff', '--no-ext-diff', '--no-textconv', '-M', '-z']
  const [names, stats] = await Promise.all([
    gitOk(repoPath, [...args, '--name-status', baseSha, targetSha, '--']),
    gitOk(repoPath, [...args, '--numstat', baseSha, targetSha, '--'])
  ])
  const files = parseNameStatusZ(names)
  const byPath = new Map(files.map((file) => [file.path, file]))
  let additions = 0
  let deletions = 0
  let binaryFiles = 0
  const records = stats.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record)
    if (!match) continue
    const path = match[3] || records[(i += 2)] // Rename: empty path, old path, new path.
    if (match[1] === '-' || match[2] === '-') {
      binaryFiles++
      continue
    }
    const added = Number(match[1])
    const removed = Number(match[2])
    additions += added
    deletions += removed
    const file = byPath.get(path)
    if (file) { file.additions = added; file.deletions = removed }
  }
  return { baseSha, targetSha, files, additions, deletions, binaryFiles }
}

export async function getComparisonDiff(repoPath: string, request: CompareDiffRequest) {
  assertSha(request.baseSha)
  assertSha(request.targetSha)
  return getTreeFileDiff(repoPath, request.baseSha, request.targetSha, request.path, request.oldPath)
}
