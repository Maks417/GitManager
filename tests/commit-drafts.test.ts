import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('commit drafts across remounts and restarts', () => {
  it('keeps separate drafts and reloads them after the renderer restarts', async () => {
    const disk = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) })
    const first = await import('../src/renderer/src/logic/commit-drafts')
    first.saveCommitDraft('/repo/a', 'A draft\n\nDetails')
    first.saveCommitDraft('/repo/b', 'B draft')
    vi.resetModules()
    const restarted = await import('../src/renderer/src/logic/commit-drafts')
    expect(restarted.loadCommitDraft('/repo/a')).toBe('A draft\n\nDetails')
    expect(restarted.loadCommitDraft('/repo/b')).toBe('B draft')
    restarted.saveCommitDraft('/repo/a', '')
    vi.resetModules()
    const afterCommit = await import('../src/renderer/src/logic/commit-drafts')
    expect(afterCommit.loadCommitDraft('/repo/a')).toBe('')
    expect(afterCommit.loadCommitDraft('/repo/b')).toBe('B draft')
  })

  it('keeps edits and clears stale drafts in memory when storage fails', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'Old disk draft', setItem: () => { throw new Error('Full') }, removeItem: () => { throw new Error('Unavailable') } })
    const drafts = await import('../src/renderer/src/logic/commit-drafts')
    drafts.saveCommitDraft('/repo', 'New draft')
    expect(drafts.loadCommitDraft('/repo')).toBe('New draft')
    drafts.saveCommitDraft('/repo', '')
    expect(drafts.loadCommitDraft('/repo')).toBe('')
  })
})
