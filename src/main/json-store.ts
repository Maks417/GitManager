import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'

/**
 * Read a JSON state file. A missing or unreadable file yields `fallback`. A corrupt file is moved
 * aside (`<file>.corrupt-<time>`) so the next save cannot overwrite the only copy of the data.
 */
export function readJsonFile<T>(file: string, fallback: T): T {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return fallback
  }
  try {
    return JSON.parse(text) as T
  } catch {
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* continue with defaults either way */
    }
    return fallback
  }
}

/** Write via a temp file and rename, so a crash mid-write never leaves a truncated file. */
export function writeJsonFileAtomic(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    // e.g. the target is briefly locked by antivirus on Windows: fall back to a direct write.
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    writeFileSync(file, text, 'utf8')
  }
}
