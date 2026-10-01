import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { getFileDiff, getWorkingTreeDiff } from '../src/git-worker/operations'
import { imageMimeFor, MAX_IMAGE_BYTES } from '../src/git-worker/ops/history'

/** Two different 1×1 PNGs. */
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)
const dataUrl = (buf: Buffer): string => `data:image/png;base64,${buf.toString('base64')}`

const dirs: string[] = []

async function git(dir: string, ...args: string[]): Promise<string> {
  const result = await runGit({ cwd: dir, args })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-img-'))
  dirs.push(dir)
  await git(dir, 'init')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'user.name', 'Test User')
  writeFileSync(join(dir, 'logo.png'), PNG_A)
  writeFileSync(join(dir, 'notes.txt'), 'hello\n')
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-m', 'initial')
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('imageMimeFor', () => {
  it('maps image extensions, case-insensitively, and nothing else', () => {
    expect(imageMimeFor('public/favicon.ico')).toBe('image/x-icon')
    expect(imageMimeFor('a/B.PNG')).toBe('image/png')
    expect(imageMimeFor('icon.svg')).toBe('image/svg+xml')
    expect(imageMimeFor('notes.txt')).toBeNull()
    expect(imageMimeFor('dir.png/readme')).toBeNull()
    expect(imageMimeFor('png')).toBeNull()
  })
})

describe('image previews in diffs', () => {
  it('shows an untracked image as added', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'new.png'), PNG_B)

    const diff = await getWorkingTreeDiff(dir, 'new.png', 'unstaged')
    expect(diff.binary).toBe(true)
    expect(diff.image).toEqual({ old: null, new: { dataUrl: dataUrl(PNG_B), bytes: PNG_B.length } })
  }, 30000)

  it('shows both versions of a modified image, unstaged and staged', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'logo.png'), PNG_B)

    const unstaged = await getWorkingTreeDiff(dir, 'logo.png', 'unstaged')
    expect(unstaged.image?.old?.dataUrl).toBe(dataUrl(PNG_A))
    expect(unstaged.image?.new?.dataUrl).toBe(dataUrl(PNG_B))

    await git(dir, 'add', 'logo.png')
    const staged = await getWorkingTreeDiff(dir, 'logo.png', 'staged')
    expect(staged.image?.old?.dataUrl).toBe(dataUrl(PNG_A))
    expect(staged.image?.new?.dataUrl).toBe(dataUrl(PNG_B))
  }, 30000)

  it('shows a deleted image as its old version only', async () => {
    const dir = await initRepo()
    unlinkSync(join(dir, 'logo.png'))

    const diff = await getWorkingTreeDiff(dir, 'logo.png', 'unstaged')
    expect(diff.image).toEqual({ old: { dataUrl: dataUrl(PNG_A), bytes: PNG_A.length }, new: null })
  }, 30000)

  it('sends no image data over the size limit, only the size', async () => {
    const dir = await initRepo()
    const big = Buffer.concat([PNG_A, Buffer.alloc(MAX_IMAGE_BYTES)])
    writeFileSync(join(dir, 'logo.png'), big)

    const unstaged = await getWorkingTreeDiff(dir, 'logo.png', 'unstaged')
    expect(unstaged.image?.new).toEqual({ dataUrl: null, bytes: big.length })

    await git(dir, 'add', 'logo.png')
    const staged = await getWorkingTreeDiff(dir, 'logo.png', 'staged')
    expect(staged.image?.new).toEqual({ dataUrl: null, bytes: big.length })
    expect(staged.image?.old?.dataUrl).toBe(dataUrl(PNG_A))
  }, 30000)

  it('previews images in commits, including the root commit', async () => {
    const dir = await initRepo()
    const root = await git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'logo.png'), PNG_B)
    await git(dir, 'commit', '-am', 'new logo')
    const sha = await git(dir, 'rev-parse', 'HEAD')

    const added = await getFileDiff(dir, root, 'logo.png')
    expect(added.image).toEqual({ old: null, new: { dataUrl: dataUrl(PNG_A), bytes: PNG_A.length } })

    const changed = await getFileDiff(dir, sha, 'logo.png')
    expect(changed.image?.old?.dataUrl).toBe(dataUrl(PNG_A))
    expect(changed.image?.new?.dataUrl).toBe(dataUrl(PNG_B))
  }, 30000)

  it('keeps the text diff of an SVG and adds its preview', async () => {
    const dir = await initRepo()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>\n'
    writeFileSync(join(dir, 'icon.svg'), svg)

    const diff = await getWorkingTreeDiff(dir, 'icon.svg', 'unstaged')
    expect(diff.binary).toBe(false)
    expect(diff.newText).toBe(svg)
    expect(diff.image?.new?.dataUrl).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  }, 30000)

  it('adds nothing to diffs of other files', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'notes.txt'), 'hello\nworld\n')

    const diff = await getWorkingTreeDiff(dir, 'notes.txt', 'unstaged')
    expect(diff.image).toBeUndefined()
  }, 30000)
})
