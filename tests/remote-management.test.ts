import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { getRemotes, saveRemote, removeRemote, setUpstream, publishBranch, getBranches } from '../src/git-worker/operations'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const temp = trackTempDirs()

describe('remote management', () => {
  it('adds and edits distinct fetch/push URLs, then removes the override and remote', async () => {
    const repo = await initRepo(temp('gm-remotes-'))
    await saveRemote(repo, { repoPath: repo, name: 'origin', url: 'https://example.com/one.git', pushUrl: 'git@example.com:one.git', create: true })
    expect(await getRemotes(repo)).toEqual([{ name: 'origin', fetchUrl: 'https://example.com/one.git', pushUrl: 'git@example.com:one.git' }])
    await saveRemote(repo, { repoPath: repo, name: 'origin', url: 'https://example.com/two.git', pushUrl: '', create: false })
    expect(await getRemotes(repo)).toEqual([{ name: 'origin', fetchUrl: 'https://example.com/two.git', pushUrl: 'https://example.com/two.git' }])
    await expect(saveRemote(repo, { repoPath: repo, name: 'origin', url: 'https://other.invalid', create: true })).rejects.toThrow(/already exists/)
    await expect(saveRemote(repo, { repoPath: repo, name: '--upload-pack=bad', url: 'https://example.com', create: true })).rejects.toThrow(/Remote names/)
    await expect(saveRemote(repo, { repoPath: repo, name: 'safe', url: '--config=bad', create: true })).rejects.toThrow(/valid Git remote/)
    await removeRemote(repo, 'origin')
    expect(await getRemotes(repo)).toEqual([])
  })

  it('publishes to an explicit remote and branch, and changes or clears tracking', async () => {
    const repo = await initRepo(temp('gm-publish-'))
    const first = temp('gm-publish-origin-')
    const second = temp('gm-publish-backup-')
    await git(first, 'init', '--bare')
    await git(second, 'init', '--bare')
    await saveRemote(repo, { repoPath: repo, name: 'origin', url: first, create: true })
    await saveRemote(repo, { repoPath: repo, name: 'backup', url: second, create: true })
    expect(await publishBranch(repo, 'backup', 'release/demo')).toEqual({ outcome: 'done' })
    const head = (await git(repo, 'rev-parse', 'HEAD')).trim()
    expect((await git(second, 'rev-parse', 'refs/heads/release/demo')).trim()).toBe(head)
    expect((await getBranches(repo)).find((branch) => branch.current)?.upstream).toBe('backup/release/demo')
    expect((await git(first, 'for-each-ref', 'refs/heads')).trim()).toBe('')
    await setUpstream(repo, { repoPath: repo, branch: 'main', upstream: null })
    expect((await getBranches(repo)).find((branch) => branch.current)?.upstream).toBeNull()
    await setUpstream(repo, { repoPath: repo, branch: 'main', upstream: 'backup/release/demo' })
    expect((await getBranches(repo)).find((branch) => branch.current)?.upstream).toBe('backup/release/demo')
    writeFileSync(join(repo, 'README.md'), '# updated\n')
    await git(repo, 'commit', '-am', 'update')
    await publishBranch(repo, 'backup', 'release/demo')
    expect((await git(second, 'rev-parse', 'release/demo')).trim()).toBe((await git(repo, 'rev-parse', 'HEAD')).trim())
    await expect(publishBranch(repo, 'backup', '--bad')).rejects.toThrow(/Invalid destination/)
  }, 30000)
})
