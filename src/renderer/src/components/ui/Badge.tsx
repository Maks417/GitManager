import type React from 'react'

interface BadgeProps {
  children: React.ReactNode
  tone?: 'default' | 'success' | 'danger'
  className?: string
  style?: React.CSSProperties
}

export function Badge({
  children,
  tone = 'default',
  className = '',
  style
}: BadgeProps): React.JSX.Element {
  const toneClass = tone === 'default' ? '' : tone
  return (
    <span className={['ref-pill', toneClass, className].filter(Boolean).join(' ')} style={style}>
      {children}
    </span>
  )
}

export function RefPill(props: BadgeProps): React.JSX.Element {
  return <Badge {...props} />
}
