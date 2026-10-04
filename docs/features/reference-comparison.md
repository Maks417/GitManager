# Feature: Reference comparison

## Purpose

Review combined file changes between branches, tags or commits, including changes introduced by a feature branch since it diverged from its base.

## User flow

1. Choose **Compare…** above History, or **Repository → Compare References…**.
2. Enter the **Base** and **Target**. Local and remote branch names are suggested; tags, commit ids and `HEAD` also work. **Swap** exchanges the inputs.
3. Leave **Changes since common ancestor** checked for a feature review: compare the merge base with the target. Uncheck it for the exact difference between the two snapshots.
4. Click **Compare**. The result shows resolved snapshot ids, changed-file count, added/deleted lines and binary-file count. Select a file for its inline or side-by-side diff. Arrow keys move through the file list.
5. A commit's actions menu also offers **Compare with HEAD…**, prefilled for an exact snapshot comparison. Click **Compare** to load it.

## Key modules & files

| Piece | File |
|---|---|
| Dialog | [CompareModal.tsx](../../src/renderer/src/features/comparison/CompareModal.tsx) |
| Ref resolution, merge base and statistics | [comparison.ts](../../src/git-worker/ops/comparison.ts) |
| Shared bounded text/image previews | [history.ts](../../src/git-worker/ops/history.ts) (`getTreeFileDiff`) |
| IPC contracts | [schemas.ts](../../src/shared/ipc/schemas.ts) (`CompareRequest`, `Comparison`, `CompareDiffRequest`) |

## Data touched

Reads refs, commits and Git blobs. It does not change the repository or checkout.

## Edge cases & rules

- Both refs resolve to immutable commit ids when Compare runs. Branch movement afterwards does not mix versions into displayed diffs; compare again to update.
- Missing refs and option-like input receive an error. An unborn branch cannot be compared until it has a commit.
- Unrelated histories have no merge base; use exact snapshot mode instead.
- Renames preserve the old path when loading content. Binary files do not contribute line counts; supported image types use the existing image viewer.
- Text and image limits match normal commit diffs. Very large files may be truncated for display.
