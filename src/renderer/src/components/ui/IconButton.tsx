import type React from 'react'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  /** Focus/hover hint; defaults to `label`. */
  hint?: string
}

export function IconButton({
  label,
  hint,
  className = '',
  type = 'button',
  children,
  title,
  ...rest
}: IconButtonProps): React.JSX.Element {
  const hintText = hint ?? label
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      data-hint={hintText}
      className={['icon-btn', 'has-hint', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
