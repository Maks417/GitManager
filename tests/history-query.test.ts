import { describe, expect, it } from 'vitest'
import { escapeBasicRegexp, isShaLike, looksLikeAuthorQuery } from '../src/git-worker/history-query'

describe('history-query helpers', () => {
  it('escapes basic-regexp metacharacters', () => {
    const escaped = escapeBasicRegexp('foo(bar)')
    expect([...escaped].map((c) => c.charCodeAt(0))).toEqual([
      102, 111, 111, 92, 40, 98, 97, 114, 92, 41
    ])
    expect(escapeBasicRegexp('a.b*c?')).toBe(String.raw`a\.b\*c\?`)
  })

  it('detects sha-like queries', () => {
    expect(isShaLike('abc1234')).toBe(true)
    expect(isShaLike('fix')).toBe(false)
    expect(isShaLike('Fix login')).toBe(false)
  })

  it('detects author-style queries', () => {
    expect(looksLikeAuthorQuery('ada@example.com')).toBe(true)
    expect(looksLikeAuthorQuery('Ada Lovelace')).toBe(true)
    expect(looksLikeAuthorQuery('timeout')).toBe(false)
  })
})
