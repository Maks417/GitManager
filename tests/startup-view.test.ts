import { describe, expect, it } from 'vitest'
import { startupView } from '../src/renderer/src/logic/startup-view'

describe('startup screen selection', () => {
  it('never displays the empty-repository welcome screen while the saved list is loading', () => {
    expect(startupView(false, 0, 'loading')).toBe('startup')
    expect(startupView(false, 2, 'loading')).toBe('startup')
  })
  it('opens an existing workspace as soon as its repository is active', () => {
    expect(startupView(true, 2, 'loading')).toBe('workspace')
    expect(startupView(true, 2, 'ready')).toBe('workspace')
  })
  it('shows welcome only after successfully loading an empty saved list', () => {
    expect(startupView(false, 0, 'ready')).toBe('welcome')
    expect(startupView(false, 0, 'failed')).toBe('startup')
  })
  it('keeps repository setup hidden when saved repositories cannot be activated', () => {
    expect(startupView(false, 2, 'ready')).toBe('startup')
    expect(startupView(false, 2, 'failed')).toBe('startup')
  })
})
