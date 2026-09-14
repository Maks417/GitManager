import { createContext } from 'react'
import type React from 'react'
import { useLayoutPrefs } from '../hooks/useLayoutPrefs'
import { useRequiredContext } from './context'

export type Layout = ReturnType<typeof useLayoutPrefs>

const LayoutContext = createContext<Layout | null>(null)

/** Preferences plus pane and column sizes. Changes while a splitter is dragged, so keep consumers light. */
export function LayoutProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const layout = useLayoutPrefs()
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>
}

export const useLayout = (): Layout => useRequiredContext(LayoutContext, 'useLayout')
