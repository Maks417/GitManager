import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { git } from './helpers/git-fixture'
import { getCommitDetail, inspectRepository, loadHistory } from '../src/git-worker/operations'

const dirs: string[] = []

async function initFixture(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-git-'))
  dirs.push(dir)
  await runGit({ cwd: dir, args: ['init', '-b', 'main'] })
  await runGit({ cwd: dir, args: ['config', 'user.email', 'test@example.com'] })
  await runGit({ cwd: dir, args: ['config', 'user.name', 'Test User'] })
  writeFileSync(join(dir, 'README.md'), '# one\n')
  await runGit({ cwd: dir, args: ['add', 'README.md'] })
  await runGit({ cwd: dir, args: ['commit', '-m', 'Initial commit'] })
  writeFileSync(join(dir, 'README.md'), '# one\n# two\n')
  await runGit({ cwd: dir, args: ['add', 'README.md'] })
  await runGit({ cwd: dir, args: ['commit', '-m', 'Update readme'] })
  await runGit({ cwd: dir, args: ['checkout', '-b', 'feature'] })
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  await runGit({ cwd: dir, args: ['add', 'feature.txt'] })
  await runGit({ cwd: dir, args: ['commit', '-m', 'Add feature'] })
  await git(dir, 'checkout', 'main')
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('git fixtures', () => {
  it('inspects repository and loads searchable history graph', async () => {
    const dir = await initFixture()
    const repo = await inspectRepository(dir)
    expect(repo.path).toBe(dir)
    expect(repo.currentBranch).toBeTruthy()

    const page = await loadHistory({ repoPath: dir, limit: 50 })
    expect(page.commits.length).toBeGreaterThanOrEqual(2)
    expect(page.headSha).toBeTruthy()

    const found = await loadHistory({ repoPath: dir, limit: 50, search: 'feature' })
    expect(found.commits.some((c) => c.subject.includes('feature') || c.subject.includes('Feature') || c.subject.includes('Add feature'))).toBe(true)

    const detail = await getCommitDetail(dir, page.commits[0].sha)
    expect(detail.commit.sha).toBe(page.commits[0].sha)
    expect(Array.isArray(detail.files)).toBe(true)
  }, 30000)
})
