import { memo } from 'react'
import type React from 'react'
import type { GraphNode } from '@shared/ipc'
import { LANE_COLORS } from '@shared/theme'

interface Props {
  node?: GraphNode
  maxLane: number
  isHead: boolean
  width: number
}

function GraphCellInner({ node, maxLane, isHead, width }: Props): React.JSX.Element {
  const h = 28
  const pad = 8
  // Spread lanes across the column when it is wider than the minimum density.
  const slots = Math.max(1, maxLane + 2)
  const laneW = Math.max(14, (width - pad * 2) / slots)

  if (!node) {
    return <svg className="graph-canvas" width={width} height={h} />
  }

  const x = (lane: number): number => pad + lane * laneW + laneW / 2
  const color = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length]
  const mid = h / 2
  const dotX = x(node.lane)

  return (
    <svg className="graph-canvas" width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
      {node.passThrough.map((lane) => (
        <line
          key={`pass-${lane}`}
          x1={x(lane)}
          y1={0}
          x2={x(lane)}
          y2={h}
          stroke={color(lane)}
          strokeWidth={2}
          opacity={0.85}
        />
      ))}
      {node.hasIncoming && (
        <line x1={dotX} y1={0} x2={dotX} y2={mid} stroke={color(node.lane)} strokeWidth={2} />
      )}
      {node.joins.map((lane) => (
        <path
          key={`join-${lane}`}
          d={`M ${x(lane)} 0 C ${x(lane)} ${h * 0.25}, ${dotX} ${h * 0.25}, ${dotX} ${mid}`}
          stroke={color(lane)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {node.connections.map((c, i) =>
        c.toLane === c.fromLane ? (
          <line
            key={`out-${i}`}
            x1={dotX}
            y1={mid}
            x2={dotX}
            y2={h}
            stroke={color(c.toLane)}
            strokeWidth={2}
          />
        ) : (
          <path
            key={`out-${i}`}
            d={`M ${dotX} ${mid} C ${dotX} ${h * 0.75}, ${x(c.toLane)} ${h * 0.75}, ${x(c.toLane)} ${h}`}
            stroke={color(c.toLane)}
            strokeWidth={2}
            fill="none"
          />
        )
      )}
      <circle
        cx={dotX}
        cy={mid}
        r={isHead ? 5.5 : 4}
        fill={color(node.lane)}
        stroke={isHead ? 'var(--head-stroke)' : 'transparent'}
        strokeWidth={isHead ? 2 : 0}
      />
    </svg>
  )
}

export const GraphCell = memo(GraphCellInner)
