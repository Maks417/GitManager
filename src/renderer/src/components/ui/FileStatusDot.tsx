import type React from 'react'
import { fileStatusLabel } from '../../logic/file-status'
import type { FileStatusKind } from '../../logic/file-status'

interface FileStatusDotProps {
  kind: FileStatusKind
  /** Where a renamed or copied file came from, named in the tooltip. */
  oldPath?: string
}

/** A dot coloured by how a file changed; the status in words is its tooltip and its screen-reader name. */
export function FileStatusDot({ kind, oldPath }: FileStatusDotProps): React.JSX.Element {
  const label = fileStatusLabel(kind, oldPath)
  return <span className={`file-status-dot ${kind}`} role="img" aria-label={label} title={label} />
}
