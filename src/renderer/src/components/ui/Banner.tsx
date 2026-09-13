import type React from 'react'

type Tone = 'danger' | 'warning' | 'info'

interface BannerProps {
  tone?: Tone
  children: React.ReactNode
  className?: string
}

export function Banner({
  tone = 'danger',
  children,
  className = ''
}: BannerProps): React.JSX.Element {
  const base = tone === 'danger' ? 'error-banner' : `banner ${tone}`
  return <div className={[base, className].filter(Boolean).join(' ')}>{children}</div>
}
