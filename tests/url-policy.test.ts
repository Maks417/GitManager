import { describe, expect, it } from 'vitest'
import { isAppUrl } from '../src/main/url-policy'

describe('isAppUrl', () => {
  const packaged = 'file:///C:/Program%20Files/Git%20Manager/resources/app.asar/out/renderer/index.html'

  it('accepts only the packaged entry file, ignoring hash and query', () => {
    expect(isAppUrl(packaged, packaged, 'win32')).toBe(true)
    expect(isAppUrl(`${packaged}#/history?x=1`, packaged, 'win32')).toBe(true)
    expect(isAppUrl(packaged.replace('C:/Program', 'c:/program'), packaged, 'win32')).toBe(true)
    expect(isAppUrl('file:///C:/Users/me/repo/docs/index.html', packaged, 'win32')).toBe(false)
    expect(isAppUrl('http://localhost:5173/', packaged, 'win32')).toBe(false)
    expect(isAppUrl('file:///home/me/App/index.html', 'file:///home/me/app/index.html', 'linux')).toBe(false)
  })

  it('matches the dev server by exact origin', () => {
    const dev = 'http://localhost:5173/'
    expect(isAppUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isAppUrl('http://localhost.evil.com:5173/', dev)).toBe(false)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('file:///C:/app/index.html', dev)).toBe(false)
    expect(isAppUrl('not a url', dev)).toBe(false)
  })
})
