import { app } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { isAppUrl } from './url-policy'

/** Vite dev server URL — honored only for unpackaged runs. */
export function getDevServerUrl(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL
  return !app.isPackaged && url ? url : null
}

export function getRendererEntryFile(): string {
  return join(__dirname, '../renderer/index.html')
}

export function getAppUrl(): string {
  return getDevServerUrl() ?? pathToFileURL(getRendererEntryFile()).href
}

export function isTrustedAppUrl(url: string): boolean {
  return isAppUrl(url, getAppUrl())
}
