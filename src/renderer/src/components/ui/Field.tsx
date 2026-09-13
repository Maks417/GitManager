import type React from 'react'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input {...props} />
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
): React.JSX.Element {
  return <textarea {...props} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return <select {...props} />
}

interface FieldProps {
  label: string
  children: React.ReactNode
  className?: string
}

export function Field({ label, children, className = '' }: FieldProps): React.JSX.Element {
  return (
    <label className={['field', className].filter(Boolean).join(' ')}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}
