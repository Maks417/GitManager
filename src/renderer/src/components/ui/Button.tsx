import type React from 'react'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: React.ReactNode
  /** Focus/hover hint; defaults to `title` when set. */
  hint?: string
}

const variantClass: Record<Variant, string> = {
  default: '',
  primary: 'primary',
  ghost: 'ghost-btn',
  danger: 'danger'
}

export function Button({
  variant = 'default',
  icon,
  hint,
  className = '',
  type = 'button',
  children,
  title,
  ...rest
}: ButtonProps): React.JSX.Element {
  const v = variantClass[variant]
  const hintText = hint ?? (typeof title === 'string' ? title : undefined)
  const classes = [v, icon ? 'btn-icon' : '', hintText ? 'has-hint' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={classes}
      title={title}
      data-hint={hintText || undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
