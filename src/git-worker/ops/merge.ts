import type { ConflictFile, MergeSides } from '@shared/ipc'
import { gitOk, runGit } from './shared'

export async function listConflictFiles(repoPath: string): Promise<ConflictFile[]> {
  const out = await gitOk(repoPath, ['ls-files', '-u'])
  const byPath = new Map<string, ConflictFile>()
  for (const line of out.split('\n')) {
    const m = line.match(/^\S+\s+\S+\s+(\d)\s+(.+)$/)
    if (!m) continue
    const stage = Number(m[1])
    const path = m[2]
    const entry = byPath.get(path) || { path, hasBase: false, hasOurs: false, hasTheirs: false }
    if (stage === 1) entry.hasBase = true
    if (stage === 2) entry.hasOurs = true
    if (stage === 3) entry.hasTheirs = true
    byPath.set(path, entry)
  }
  return [...byPath.values()]
}

export async function getMergeSides(repoPath: string, path: string): Promise<MergeSides> {
  const showStage = async (stage: 1 | 2 | 3): Promise<string> => {
    const r = await runGit({ cwd: repoPath, args: ['show', `:${stage}:${path}`] })
    return r.code === 0 ? r.stdout : ''
  }
  const [base, ours, theirs] = await Promise.all([showStage(1), showStage(2), showStage(3)])
  const working = await runGit({
    cwd: repoPath,
    args: ['show', `:${path}`]
  }).catch(async () => {
    const { readFile } = await import('fs/promises')
    try {
      return { stdout: await readFile(`${repoPath}/${path}`, 'utf8'), stderr: '', code: 0 }
    } catch {
      return { stdout: ours, stderr: '', code: 0 }
    }
  })

  let result = working.stdout
  if (!result) {
    const { mergeSidesToEditable } = await import('@merge-core/conflict')
    result = mergeSidesToEditable(base, ours, theirs).result
  }

  return { path, base, ours, theirs, result }
}

export async function saveMergeResult(repoPath: string, path: string, content: string): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises')
  const { dirname, join } = await import('path')
  const full = join(repoPath, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
  await gitOk(repoPath, ['add', '--', path])
}
