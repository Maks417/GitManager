import { z } from 'zod'
import { ConflictSideSchema, type ConflictSide } from '@shared/ipc'
import { SHA_RE } from '@shared/sha'

/** Non-empty path / id string from renderer IPC. */
export const NonEmptyStringSchema = z.string().min(1)

/** Branch / tag / commit-ish. Option-like values (`--exec=…`) and control characters are rejected. */
export const RefSchema = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith('-') && !/[\0\r\n]/.test(v), 'Invalid reference')

export const ShaSchema = z.string().regex(SHA_RE, 'Invalid commit id')

export const StashRefSchema = z.string().regex(/^stash@\{\d+\}$/, 'Invalid stash reference')

/** Repository-relative file path: not absolute, no `..` segments, no NUL. */
export const RepoRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (p) => !p.includes('\0') && !/^([a-zA-Z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes('..'),
    'Invalid repository path'
  )

export const PathsArraySchema = z.array(RepoRelativePathSchema)

export function parseRepoPath(raw: unknown): string {
  return NonEmptyStringSchema.parse(raw)
}

export function parseAccountId(raw: unknown): string {
  return NonEmptyStringSchema.parse(raw)
}

export function parseRef(raw: unknown): string {
  return RefSchema.parse(raw)
}

export function parseSha(raw: unknown): string {
  return ShaSchema.parse(raw)
}

export function parseOptionalStashRef(raw: unknown): string | undefined {
  return raw === undefined || raw === null ? undefined : StashRefSchema.parse(raw)
}

export function parseRepoRelativePath(raw: unknown): string {
  return RepoRelativePathSchema.parse(raw)
}

export function parseConflictSide(raw: unknown): ConflictSide {
  return ConflictSideSchema.parse(raw)
}

export function parsePaths(raw: unknown): string[] {
  return PathsArraySchema.parse(raw)
}
