import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import {
  AppPreferencesSchema,
  ProviderAccountSchema,
  RepositorySchema,
  type AppPreferences,
  type ProviderAccount,
  type Repository
} from '@shared/ipc'
import { readJsonFile, writeJsonFileAtomic } from './json-store'
import { decodeSecret, encodeSecret } from './secrets'

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'state')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Entries that no longer match the schema are dropped instead of crashing callers. */
function parseList<T>(raw: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function loadPreferences(): AppPreferences {
  const raw = readJsonFile<unknown>(join(dataDir(), 'preferences.json'), {})
  return AppPreferencesSchema.parse(isPlainObject(raw) ? raw : {})
}

export function savePreferences(partial: Partial<AppPreferences>): AppPreferences {
  const next = AppPreferencesSchema.parse({
    ...loadPreferences(),
    ...(isPlainObject(partial) ? partial : {})
  })
  writeJsonFileAtomic(join(dataDir(), 'preferences.json'), next)
  return next
}

export function loadRepositories(): Repository[] {
  return parseList(readJsonFile<unknown>(join(dataDir(), 'repositories.json'), []), RepositorySchema)
}

export function saveRepositories(repos: Repository[]): void {
  writeJsonFileAtomic(join(dataDir(), 'repositories.json'), repos)
}

const StoredAccountSchema = ProviderAccountSchema.extend({
  tokenEnc: z.string().optional(),
  /** How `tokenEnc` was produced; missing for entries saved by older versions. */
  tokenScheme: z.enum(['safeStorage', 'plain']).optional(),
  /** Identity the token is paired with for API calls (the Atlassian email for Bitbucket). */
  authUser: z.string().optional()
})
type StoredAccount = z.infer<typeof StoredAccountSchema>

export function loadAccounts(): StoredAccount[] {
  return parseList(readJsonFile<unknown>(join(dataDir(), 'accounts.json'), []), StoredAccountSchema)
}

export function saveAccounts(accounts: StoredAccount[]): void {
  writeJsonFileAtomic(join(dataDir(), 'accounts.json'), accounts)
}

export function storeAccountToken(
  account: ProviderAccount,
  token: string,
  authUser?: string
): ProviderAccount {
  const { scheme, data } = encodeSecret(safeStorage, token)
  const accounts = loadAccounts().filter((a) => a.id !== account.id)
  accounts.push({ ...account, tokenEnc: data, tokenScheme: scheme, ...(authUser ? { authUser } : {}) })
  saveAccounts(accounts)
  return { ...account, secureStorage: scheme === 'safeStorage' }
}

export function getAccountToken(accountId: string): string | null {
  const account = loadAccounts().find((a) => a.id === accountId)
  if (!account?.tokenEnc) return null
  return decodeSecret(safeStorage, account.tokenEnc, account.tokenScheme)
}
