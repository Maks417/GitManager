import { describe, expect, it } from 'vitest'
import { parseHistorySearch } from '../src/shared/history-query'

describe('parseHistorySearch', () => {
  it('treats plain text, including several words and regex characters, as a message search', () => {
    expect(parseHistorySearch('fix login bug')).toEqual({ kind: 'message', text: 'fix login bug' })
    expect(parseHistorySearch('  fix(auth) {beta} a|b ')).toEqual({ kind: 'message', text: 'fix(auth) {beta} a|b' })
  })

  it('only treats 7–40 hex digits as a commit id', () => {
    expect(parseHistorySearch('abc1234')).toEqual({ kind: 'sha', sha: 'abc1234', text: 'abc1234' })
    expect(parseHistorySearch('added')).toEqual({ kind: 'message', text: 'added' })
    expect(parseHistorySearch('decade')).toEqual({ kind: 'message', text: 'decade' })
  })

  it('uses an explicit author: prefix for author searches', () => {
    expect(parseHistorySearch('author: Ada Lovelace')).toEqual({ kind: 'author', text: 'Ada Lovelace' })
    expect(parseHistorySearch('Author:ada@example.com')).toEqual({ kind: 'author', text: 'ada@example.com' })
  })

  it('ignores empty input', () => {
    expect(parseHistorySearch('   ')).toBeNull()
    expect(parseHistorySearch(undefined)).toBeNull()
  })
})
