import { z } from 'zod'

/** Non-empty path / id / ref string from renderer IPC. */
export const NonEmptyStringSchema = z.string().min(1)

export const PathsArraySchema = z.array(z.string().min(1))

export function parseRepoPath(raw: unknown): string {
  return NonEmptyStringSchema.parse(raw)
}

export function parseAccountId(raw: unknown): string {
  return NonEmptyStringSchema.parse(raw)
}

export function parseRef(raw: unknown): string {
  return NonEmptyStringSchema.parse(raw)
}

export function parsePaths(raw: unknown): string[] {
  return PathsArraySchema.parse(raw)
}
