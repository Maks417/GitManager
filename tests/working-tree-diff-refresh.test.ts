import { describe, expect, it } from 'vitest'
import { statusChangeTouches, workingTreeDiffDelayMs } from '../src/renderer/src/logic/working-tree-diff-refresh'

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

describe('statusChangeTouches', () => {
  it('reloads the focused diff only for refreshes that may have changed it', () => {
    expect(statusChangeTouches(null, 'src/a.ts')).toBe(true)
    expect(statusChangeTouches(['src/b.ts'], 'src/a.ts')).toBe(false)
    expect(statusChangeTouches(['src/b.ts', 'SRC/A.ts'], 'src/a.ts')).toBe(true)
    expect(statusChangeTouches(['build/out/x.js'], 'build/')).toBe(true)
    expect(statusChangeTouches(['src/a.ts'], null)).toBe(false)
  })
})
