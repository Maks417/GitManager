import { describe, expect, it } from 'vitest'
import { selectionForNewRepository } from '../src/renderer/src/logic/new-repo-selection'

describe('selectionForNewRepository', () => {
  it('keeps the working copy selected when the Changes view is shown', () => {
    expect(selectionForNewRepository('changes')).toEqual({ kind: 'working-copy' })
  })

  it('selects nothing in History, so the first page can select a commit', () => {
    expect(selectionForNewRepository('history')).toBeNull()
  })
})
