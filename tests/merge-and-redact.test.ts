import { describe, expect, it } from 'vitest'
import {
  applyRegionResolution,
  hasUnresolvedMarkers,
  mergeSidesToEditable,
  parseConflictMarkers
} from '../src/merge-core/conflict'
import { redactSecrets } from '../src/git-worker/git-runner'

describe('merge conflict parsing', () => {
  it('parses conflict markers into regions', () => {
    const text = [
      'header',
      '<<<<<<< Ours',
      'aaa',
      '||||||| Base',
      'bbb',
      '=======',
      'ccc',
      '>>>>>>> Theirs',
      'footer'
    ].join('\n')
    const regions = parseConflictMarkers(text)
    expect(regions).toHaveLength(1)
    expect(regions[0].ours).toBe('aaa')
    expect(regions[0].theirs).toBe('ccc')
    expect(regions[0].base).toBe('bbb')
  })

  it('applies ours/theirs/both resolutions', () => {
    const { result, regions } = mergeSidesToEditable('base', 'left', 'right')
    expect(hasUnresolvedMarkers(result)).toBe(true)
    const resolved = applyRegionResolution(result, regions[0], 'ours')
    expect(resolved.text.includes('<<<<<<<')).toBe(false)
    expect(resolved.text).toContain('left')
    expect(resolved.region.resolved).toBe(true)

    const both = applyRegionResolution(result, regions[0], 'both')
    expect(both.text).toContain('left')
    expect(both.text).toContain('right')
  })
})

describe('redactSecrets', () => {
  it('redacts basic auth and tokens', () => {
    const input =
      'https://user:secret@github.com/org/repo.git ghp_abcdefghijklmnopqrstuvwxyz0123456789 Authorization: Bearer tok_abc'
    const out = redactSecrets(input)
    expect(out).not.toContain('secret')
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(out).toContain('***')
  })
})
