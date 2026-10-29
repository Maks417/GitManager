import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { readJsonFile, writeJsonFileAtomic } from '../src/main/json-store'
import { decodeSecret, encodeSecret, hasSecureStorage, type SafeStorageLike } from '../src/main/secrets'
import { AppPreferencesSchema } from '../src/shared/ipc'
import { LAYOUT_DEFAULTS } from '../src/shared/layout-defaults'
import { COMMIT_BOX_MAX, COMMIT_BOX_MIN } from '../src/renderer/src/logic/commit-box-height'
import { parseStoredRepositories } from '../src/main/stored-repos'
import { trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('json state files', () => {
  it('returns the fallback for a missing file', () => {
    expect(readJsonFile(join(tempDir('gm-store-'), 'missing.json'), ['fallback'])).toEqual(['fallback'])
  })

  it('keeps a corrupt file aside so the next save cannot destroy it', () => {
    const dir = tempDir('gm-store-')
    const file = join(dir, 'repositories.json')
    writeFileSync(file, '[{"id": "C:/repo", "na')

    expect(readJsonFile(file, [])).toEqual([])
    const backups = readdirSync(dir).filter((f) => f.startsWith('repositories.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe('[{"id": "C:/repo", "na')
  })

  it('writes atomically and leaves no temp files', () => {
    const dir = tempDir('gm-store-')
    const file = join(dir, 'preferences.json')
    writeJsonFileAtomic(file, { a: 1 })
    writeJsonFileAtomic(file, { a: 2 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 })
    expect(readdirSync(dir)).toEqual(['preferences.json'])
  })
})

describe('preferences schema', () => {
  it('recovers each invalid field instead of rejecting the whole file', () => {
    const prefs = AppPreferencesSchema.parse({
      theme: 'neon',
      detailDock: 'right',
      sidebarWidth: 5000,
      detailWidth: 10,
      inspectorHeight: 'tall',
      liveStatusWatch: 'yes'
    })
    expect(prefs).toMatchObject({
      theme: 'system',
      detailDock: 'right',
      sidebarWidth: 480,
      detailWidth: 280,
      inspectorHeight: LAYOUT_DEFAULTS.inspectorHeight,
      liveStatusWatch: true
    })
  })

  it('shows diffs inline unless side by side was chosen', () => {
    expect(AppPreferencesSchema.parse({}).diffView).toBe('inline')
    expect(AppPreferencesSchema.parse({ diffView: 'split' }).diffView).toBe('inline')
    expect(AppPreferencesSchema.parse({ diffView: 'side-by-side' }).diffView).toBe('side-by-side')
  })

  it('shows syntax colors unless they were turned off', () => {
    expect(AppPreferencesSchema.parse({}).syntaxHighlighting).toBe(true)
    expect(AppPreferencesSchema.parse({ syntaxHighlighting: 'no' }).syntaxHighlighting).toBe(true)
    expect(AppPreferencesSchema.parse({ syntaxHighlighting: false }).syntaxHighlighting).toBe(false)
  })

  it('lays out the merge editor in columns unless stacked was chosen', () => {
    expect(AppPreferencesSchema.parse({}).mergeEditorLayout).toBe('columns')
    expect(AppPreferencesSchema.parse({ mergeEditorLayout: 'rows' }).mergeEditorLayout).toBe('columns')
    expect(AppPreferencesSchema.parse({ mergeEditorLayout: 'stacked' }).mergeEditorLayout).toBe('stacked')
  })

  it('keeps the commit message height within its limits', () => {
    expect(AppPreferencesSchema.parse({}).commitMessageHeight).toBe(LAYOUT_DEFAULTS.commitMessageHeight)
    expect(AppPreferencesSchema.parse({ commitMessageHeight: 5 }).commitMessageHeight).toBe(COMMIT_BOX_MIN)
    expect(AppPreferencesSchema.parse({ commitMessageHeight: 9000 }).commitMessageHeight).toBe(COMMIT_BOX_MAX)
    expect(AppPreferencesSchema.parse({ commitMessageHeight: 'big' }).commitMessageHeight).toBe(
      LAYOUT_DEFAULTS.commitMessageHeight
    )
  })
})

describe('token storage', () => {
  const fakeStorage = (available: boolean, backend?: string): SafeStorageLike => ({
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => {
      const s = b.toString()
      if (!s.startsWith('enc:')) throw new Error('not encrypted')
      return s.slice(4)
    },
    ...(backend ? { getSelectedStorageBackend: () => backend } : {})
  })

  it('encrypts with the OS store and records the scheme', () => {
    const encoded = encodeSecret(fakeStorage(true), 'ghp_token', 'win32')
    expect(encoded.scheme).toBe('safeStorage')
    expect(decodeSecret(fakeStorage(true), encoded.data, encoded.scheme)).toBe('ghp_token')
  })

  it('treats Linux basic_text as unencrypted', () => {
    expect(hasSecureStorage(fakeStorage(true, 'basic_text'), 'linux')).toBe(false)
    expect(hasSecureStorage(fakeStorage(true, 'gnome_libsecret'), 'linux')).toBe(true)
    expect(encodeSecret(fakeStorage(true, 'basic_text'), 'tok', 'linux').scheme).toBe('plain')
  })

  it('returns null rather than garbage when the OS store is no longer available', () => {
    const { data } = encodeSecret(fakeStorage(true), 'tok', 'win32')
    expect(decodeSecret(fakeStorage(false), data, 'safeStorage')).toBeNull()
  })

  it('reads entries saved before the scheme was recorded', () => {
    expect(decodeSecret(fakeStorage(true), Buffer.from('enc:tok').toString('base64'))).toBe('tok')
    expect(decodeSecret(fakeStorage(true), Buffer.from('tok').toString('base64'))).toBe('tok')
  })
})

describe('saved repositories', () => {
  it('repairs entries that no longer fit the schema instead of dropping them', () => {
    const repos = parseStoredRepositories([
      { id: 'C:/ok', name: 'ok', path: 'C:/ok', currentBranch: 'main', remotes: [], worktreeOf: null },
      // An older or hand-edited entry: remotes missing, branch of the wrong type.
      { id: 'C:/old', path: 'C:/old', currentBranch: 3 },
      { name: 'no path' },
      'junk'
    ])
    expect(repos.map((r) => r.id)).toEqual(['C:/ok', 'C:/old'])
    expect(repos[1]).toMatchObject({ name: 'old', currentBranch: null, remotes: [], worktreeOf: null })
    expect(parseStoredRepositories({})).toEqual([])
  })
})
