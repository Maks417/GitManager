import type React from 'react'
import type { GraphNode } from '@shared/ipc'
import { LANE_COLORS } from '@shared/theme'

interface Props {
  node?: GraphNode
  maxLane: number
  isHead: boolean
  width: number
}

export function GraphCell({ node, maxLane, isHead, width }: Props): React.JSX.Element {
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

  return (
    <svg className="graph-canvas" width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
      {node.lanes.map((lane) => (
        <line
          key={`lane-${lane}`}
          x1={x(lane)}
          y1={0}
          x2={x(lane)}
          y2={h}
          stroke={color(lane)}
          strokeWidth={2}
          opacity={0.85}
        />
      ))}
      {node.connections.map((c, i) => {
        if (c.fromLane === c.toLane) {
          return (
            <line
              key={`c-${i}`}
              x1={x(c.fromLane)}
              y1={h / 2}
              x2={x(c.toLane)}
              y2={h}
              stroke={color(c.toLane)}
              strokeWidth={2}
            />
          )
        }
        const midY = h * 0.75
        return (
          <path
            key={`c-${i}`}
            d={`M ${x(c.fromLane)} ${h / 2} C ${x(c.fromLane)} ${midY}, ${x(c.toLane)} ${midY}, ${x(c.toLane)} ${h}`}
            stroke={color(c.toLane)}
            strokeWidth={2}
            fill="none"
          />
        )
      })}
      <circle
        cx={x(node.lane)}
        cy={h / 2}
        r={isHead ? 5.5 : 4}
        fill={color(node.lane)}
        stroke={isHead ? 'var(--head-stroke)' : 'transparent'}
        strokeWidth={isHead ? 2 : 0}
      />
      <line x1={x(maxLane)} y1={0} x2={x(maxLane)} y2={0} stroke="transparent" />
    </svg>
  )
}
