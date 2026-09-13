import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AppPreferencesSchema, type AppPreferences, type ProviderAccount, type Repository } from '@shared/ipc'

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'state')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

export function loadPreferences(): AppPreferences {
  const raw = readJson(join(dataDir(), 'preferences.json'), {})
  return AppPreferencesSchema.parse(raw)
}

export function savePreferences(partial: Partial<AppPreferences>): AppPreferences {
  const next = AppPreferencesSchema.parse({ ...loadPreferences(), ...partial })
  writeJson(join(dataDir(), 'preferences.json'), next)
  return next
}

export function loadRepositories(): Repository[] {
  return readJson(join(dataDir(), 'repositories.json'), [])
}

export function saveRepositories(repos: Repository[]): void {
  writeJson(join(dataDir(), 'repositories.json'), repos)
}

interface StoredAccount extends ProviderAccount {
  tokenEnc?: string
  tokenPlain?: string
}

export function loadAccounts(): StoredAccount[] {
  return readJson(join(dataDir(), 'accounts.json'), [])
}

export function saveAccounts(accounts: StoredAccount[]): void {
  writeJson(join(dataDir(), 'accounts.json'), accounts)
}

export function encryptSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  return Buffer.from(value, 'utf8').toString('base64')
}

export function decryptSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  return Buffer.from(value, 'base64').toString('utf8')
}

export function storeAccountToken(account: ProviderAccount, token: string): ProviderAccount {
  const accounts = loadAccounts().filter((a) => a.id !== account.id)
  accounts.push({
    ...account,
    tokenEnc: encryptSecret(token)
  })
  saveAccounts(accounts)
  return account
}

export function getAccountToken(accountId: string): string | null {
  const account = loadAccounts().find((a) => a.id === accountId)
  if (!account?.tokenEnc) return null
  try {
    return decryptSecret(account.tokenEnc)
  } catch {
    return null
  }
}
