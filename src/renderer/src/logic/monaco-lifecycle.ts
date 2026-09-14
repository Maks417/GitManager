/** The parts of a Monaco diff editor that teardown needs (structural, so tests can fake it). */
export interface SettlingDiffEditor {
  /** Null until Monaco has computed the diff of the editor's models. */
  getLineChanges(): unknown[] | null
  onDidUpdateDiff(listener: () => void): { dispose(): void }
  dispose(): void
}

export interface DisposableModel {
  dispose(): void
}

/** Upper bound for Monaco's diff worker to answer, including diffs queued ahead of this one. */
export const DIFF_SETTLE_TIMEOUT_MS = 30_000

/**
 * Dispose a diff editor, then its models, without racing Monaco's diff worker.
 *
 * The worker computes one diff at a time, and Monaco never cancels the computation of an editor that is
 * detached or disposed. Disposing the models while their diff is still queued (behind a large file, say)
 * leaves the worker nothing to diff, and Monaco throws "no diff result available". Disposing models
 * while an editor still shows them throws "TextModel got disposed before DiffEditorWidget model got
 * reset". So wait until this editor's diff has arrived — or give up after `timeoutMs` — and dispose the
 * editor before its models. Callers give each editor its own models and never edit them, so one
 * arrived diff means nothing is left in the worker for them.
 */
export function disposeWhenDiffSettled(
  editor: SettlingDiffEditor,
  models: DisposableModel[],
  timeoutMs = DIFF_SETTLE_TIMEOUT_MS
): void {
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let subscription: { dispose(): void } | undefined

  const teardown = (): void => {
    if (done) return
    done = true
    if (timer !== undefined) clearTimeout(timer)
    subscription?.dispose()
    editor.dispose()
    for (const model of models) model.dispose()
  }

  if (editor.getLineChanges() !== null) {
    teardown()
    return
  }
  subscription = editor.onDidUpdateDiff(teardown)
  if (!done) timer = setTimeout(teardown, timeoutMs)
}

/** The text a diff editor was created with, numbered so a change of text can mount a new editor. */
export interface ContentVersion {
  original: string
  modified: string
  version: number
}

export function nextContentVersion(
  previous: ContentVersion | null,
  original: string,
  modified: string
): ContentVersion {
  if (!previous) return { original, modified, version: 0 }
  if (previous.original === original && previous.modified === modified) return previous
  return { original, modified, version: previous.version + 1 }
}
