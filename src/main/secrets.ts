export type TokenScheme = 'safeStorage' | 'plain'

/** The subset of Electron's `safeStorage` used here (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  getSelectedStorageBackend?(): string
}

/** True only when secrets are protected by DPAPI, the Keychain, or a real Linux secret store. */
export function hasSecureStorage(storage: SafeStorageLike, platform: string = process.platform): boolean {
  if (!storage.isEncryptionAvailable()) return false
  // Linux 'basic_text' encrypts with a hard-coded password — effectively plaintext.
  if (platform === 'linux' && storage.getSelectedStorageBackend?.() === 'basic_text') return false
  return true
}

export function encodeSecret(
  storage: SafeStorageLike,
  value: string,
  platform: string = process.platform
): { scheme: TokenScheme; data: string } {
  if (hasSecureStorage(storage, platform)) {
    return { scheme: 'safeStorage', data: storage.encryptString(value).toString('base64') }
  }
  return { scheme: 'plain', data: Buffer.from(value, 'utf8').toString('base64') }
}

/** Returns null when an encrypted secret can no longer be decrypted (e.g. the OS store is gone). */
export function decodeSecret(storage: SafeStorageLike, data: string, scheme?: TokenScheme): string | null {
  if (scheme === 'plain') return Buffer.from(data, 'base64').toString('utf8')
  if (scheme === 'safeStorage') {
    if (!storage.isEncryptionAvailable()) return null
    try {
      return storage.decryptString(Buffer.from(data, 'base64'))
    } catch {
      return null
    }
  }
  // Entries saved before the scheme was recorded: encrypted if possible, else base64 plaintext.
  if (storage.isEncryptionAvailable()) {
    try {
      return storage.decryptString(Buffer.from(data, 'base64'))
    } catch {
      /* fall through */
    }
  }
  return Buffer.from(data, 'base64').toString('utf8')
}
