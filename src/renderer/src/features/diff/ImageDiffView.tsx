import { useState } from 'react'
import type React from 'react'
import type { ImagePreview, ImageSide } from '@shared/ipc'
import { formatBytes } from '../../lib/format'

interface Props {
  image: ImagePreview
  /** Before and after next to each other; stacked otherwise. */
  sideBySide: boolean
}

/** Before / after previews of an image file, or the single version of an added or deleted one. */
export function ImageDiffView({ image, sideBySide }: Props): React.JSX.Element {
  const panels: { label: string; side: ImageSide }[] = []
  if (image.old && image.new) {
    panels.push({ label: 'Before', side: image.old }, { label: 'After', side: image.new })
  } else if (image.new) {
    panels.push({ label: 'Added', side: image.new })
  } else if (image.old) {
    panels.push({ label: 'Deleted', side: image.old })
  }
  if (panels.length === 0) return <div className="empty-state muted">No image to show</div>

  return (
    <div className={`image-diff ${sideBySide ? 'image-diff-columns' : 'image-diff-stacked'}`}>
      {panels.map((p) => (
        // Keyed by content so a changed image starts without the previous one's size or error.
        <ImagePanel key={`${p.label}:${p.side.bytes}:${p.side.dataUrl?.length ?? 0}`} label={p.label} side={p.side} />
      ))}
    </div>
  )
}

/** Icons smaller than this are scaled up by a whole factor, so their pixels stay crisp and visible. */
const SMALL_IMAGE_TARGET = 128

function ImagePanel({ label, side }: { label: string; side: ImageSide }): React.JSX.Element {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const size = formatBytes(side.bytes)

  let body: React.ReactNode
  if (!side.dataUrl) {
    body = <div className="image-diff-note muted">Too large to preview ({size})</div>
  } else if (failed) {
    body = <div className="image-diff-note muted">Can’t preview this image</div>
  } else {
    const scale = natural ? Math.floor(SMALL_IMAGE_TARGET / Math.max(natural.width, natural.height, 1)) : 1
    body = (
      <img
        src={side.dataUrl}
        alt={label}
        draggable={false}
        className={scale > 1 ? 'image-diff-pixelated' : undefined}
        style={natural && scale > 1 ? { width: natural.width * scale, height: natural.height * scale } : undefined}
        onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <figure className="image-diff-panel">
      <div className="image-diff-canvas">{body}</div>
      <figcaption className="muted">
        <span className="image-diff-label">{label}</span>
        {natural && (
          <>
            {' · '}
            {natural.width} × {natural.height}
          </>
        )}
        {' · '}
        {size}
      </figcaption>
    </figure>
  )
}
