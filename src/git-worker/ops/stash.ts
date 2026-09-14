import { assertStashRef } from './guards'
import { gitOk, resolveHeadSha, runGit } from './shared'

export async function stashSave(repoPath: string, message?: string): Promise<void> {
  const head = await resolveHeadSha(repoPath)
  if (!head) {
    throw new Error('Cannot stash before the first commit. Commit your files first, then stash.')
  }
  const args = ['stash', 'push', '-u']
  if (message) args.push('-m', message)
  await gitOk(repoPath, args)
}

export async function listStashes(repoPath: string): Promise<
  Array<{ index: number; message: string; reflogSelector: string }>
> {
  const result = await runGit({
    cwd: repoPath,
    args: ['stash', 'list', '--format=%gd%x00%s']
  })
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `git stash list failed (${result.code})`)
  }
  const entries: Array<{ index: number; message: string; reflogSelector: string }> = []
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue
    const [sel, message = ''] = line.split('\0')
    const m = sel?.match(/stash@\{(\d+)\}/)
    if (!m || !sel) continue
    entries.push({
      index: Number(m[1]),
      message: message.trim() || '(stash)',
      reflogSelector: sel.trim()
    })
  }
  return entries
}

export async function stashApply(repoPath: string, ref = 'stash@{0}'): Promise<void> {
  await gitOk(repoPath, ['stash', 'apply', assertStashRef(ref)])
}

export async function stashPop(repoPath: string, ref = 'stash@{0}'): Promise<void> {
  await gitOk(repoPath, ['stash', 'pop', assertStashRef(ref)])
}

export async function stashDrop(repoPath: string, ref = 'stash@{0}'): Promise<void> {
  await gitOk(repoPath, ['stash', 'drop', assertStashRef(ref)])
}
