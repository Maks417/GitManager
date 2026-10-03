import { describe, expect, it } from 'vitest'
import { workingTreeDiffDelayMs } from '../src/renderer/src/logic/working-tree-diff-refresh'

describe('workingTreeDiffDelayMs', () => {
  it('loads a newly focused file immediately', () => {
    expect(workingTreeDiffDelayMs(null, 'repo\0a.ts\0unstaged', 150)).toBe(0)
    expect(workingTreeDiffDelayMs('repo\0a.ts\0unstaged', 'repo\0b.ts\0unstaged', 150)).toBe(0)
    expect(workingTreeDiffDelayMs('repo\0a.ts\0unstaged', 'repo\0a.ts\0staged', 150)).toBe(0)
  })

  it('debounces a status refresh of the same file and side', () => {
    expect(workingTreeDiffDelayMs('repo\0a.ts\0unstaged', 'repo\0a.ts\0unstaged', 150)).toBe(150)
  })
})
