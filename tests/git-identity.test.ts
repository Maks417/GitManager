import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { getGitIdentity, setGitIdentity } from '../src/git-worker/operations'
import { parseIdentitySettings } from '../src/git-worker/ops/identity'

const dirs: string[] = []

async function initBareIdentityRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-id-'))
  dirs.push(dir)
  await runGit({ cwd: dir, args: ['init'] })
  // Clear local identity so effective values come from what we set
  await runGit({ cwd: dir, args: ['config', '--local', '--unset-all', 'user.name'] }).catch(() => undefined)
  await runGit({ cwd: dir, args: ['config', '--local', '--unset-all', 'user.email'] }).catch(() => undefined)
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('git identity', () => {
  it('sets and reads local user.name / user.email', async () => {
    const dir = await initBareIdentityRepo()
    const saved = await setGitIdentity(dir, 'Ada Lovelace', 'ada@example.com', 'local')
    expect(saved.name).toBe('Ada Lovelace')
    expect(saved.email).toBe('ada@example.com')
    expect(saved.nameSource).toBe('local')
    expect(saved.emailSource).toBe('local')

    const read = await getGitIdentity(dir)
    expect(read).toEqual(saved)
  }, 30000)
})

describe('parseIdentitySettings', () => {
  it('takes the last value of each key and the config file it came from', () => {
    const out = [
      'system\0user.name\nSystem Name',
      'global\0user.name\nAda Lovelace',
      'global\0user.email\nada@example.com',
      'local\0user.name\nAda L.',
      // A `-c` setting wins but is not stored anywhere, so the file before it stays the source.
      'command\0user.email\nada@work.example',
      ''
    ].join('\0')
    expect(parseIdentitySettings(out)).toEqual({
      name: 'Ada L.',
      email: 'ada@work.example',
      nameSource: 'local',
      emailSource: 'global'
    })
  })

  it('reports unset keys, and a worktree setting as local', () => {
    expect(parseIdentitySettings('worktree\0user.email\nada@example.com\0')).toEqual({
      name: '',
      email: 'ada@example.com',
      nameSource: 'unset',
      emailSource: 'local'
    })
  })
})
