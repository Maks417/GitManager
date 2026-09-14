import { createContext, useState, useSyncExternalStore } from 'react'
import type React from 'react'
import { ConfirmDialog } from '../components/ui'
import { createConfirmQueue, type ConfirmRequest } from '../logic/confirm-queue'
import { useRequiredContext } from './context'

/** Ask the user to confirm; resolves true when confirmed and false when cancelled. */
export type Confirm = (request: ConfirmRequest) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/** In-app confirmation dialogs: native confirm() blocks the whole window and cannot be styled. */
export function ConfirmProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [queue] = useState(() => createConfirmQueue<ConfirmRequest>())
  const [confirm] = useState<Confirm>(() => (request: ConfirmRequest) => queue.enqueue(request))
  const active = useSyncExternalStore(queue.subscribe, queue.current)

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* Rendered after the app, so it paints over any dialog that asked for the confirmation. */}
      {active && (
        <ConfirmDialog
          key={active.id}
          title={active.request.title}
          message={active.request.message}
          confirmLabel={active.request.confirmLabel}
          danger={active.request.danger}
          onConfirm={() => queue.settle(true)}
          onCancel={() => queue.settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = (): Confirm => useRequiredContext(ConfirmContext, 'useConfirm')
