import { useContext, type Context } from 'react'

/** Read a context whose provider must be mounted above the caller (see AppProviders). */
export function useRequiredContext<T>(context: Context<T | null>, hookName: string): T {
  const value = useContext(context)
  if (value === null) throw new Error(`${hookName} must be used inside AppProviders`)
  return value
}
