/** A progress update parsed from Git's `--progress` output. */
export interface GitProgressLine {
  /** Git's step, e.g. "Receiving objects". */
  phase: string
  percent: number | null
  /** Reported by the server ("remote: Counting objects"). */
  remote: boolean
}

// "Receiving objects:  58% (176/302), 532.00 KiB | 1.00 MiB/s" and "remote: Counting objects: 100% (4/4), done."
const PERCENT_RE = /^(remote:\s*)?([A-Z][A-Za-z ]*?):\s+(\d{1,3})% \(\d+\/\d+\)/
// "remote: Enumerating objects: 302, done."
const COUNT_RE = /^(remote:\s*)?([A-Z][A-Za-z ]*?):\s+\d+(?:, done\.)?$/
// Transfer summaries that carry no error information.
const CHATTER_RE = /^(remote:\s*)?(Total \d+ \(delta \d+\)|Delta compression using up to \d+ threads)/

export function parseGitProgressLine(line: string): GitProgressLine | null {
  const text = line.trim()
  const withPercent = PERCENT_RE.exec(text)
  if (withPercent) {
    return { phase: withPercent[2], percent: Math.min(100, Number(withPercent[3])), remote: Boolean(withPercent[1]) }
  }
  const withCount = COUNT_RE.exec(text)
  if (withCount) return { phase: withCount[2], percent: null, remote: Boolean(withCount[1]) }
  return null
}

/** Progress and transfer chatter, which is left out of the stderr kept for error messages. */
export function isProgressNoise(line: string): boolean {
  const text = line.trim()
  return text === '' || parseGitProgressLine(text) !== null || CHATTER_RE.test(text)
}

/** Splits streamed output into lines at `\n` and at `\r`, where Git redraws progress in place. */
export function createLineSplitter(onLine: (line: string) => void): {
  write(chunk: string): void
  end(): void
} {
  let pending = ''
  return {
    write(chunk) {
      pending += chunk
      const parts = pending.split(/\r\n|\r|\n/)
      pending = parts.pop() ?? ''
      for (const part of parts) onLine(part)
    },
    end() {
      if (pending) onLine(pending)
      pending = ''
    }
  }
}

/** Forward at most one update per `intervalMs`, but always the first of a phase and every 100%. */
export function throttleProgress<T extends { phase: string; percent: number | null }>(
  emit: (update: T) => void,
  intervalMs = 100
): (update: T) => void {
  let lastPhase: string | null = null
  let lastAt = 0
  return (update) => {
    const now = Date.now()
    if (update.phase !== lastPhase || update.percent === 100 || now - lastAt >= intervalMs) {
      lastPhase = update.phase
      lastAt = now
      emit(update)
    }
  }
}
