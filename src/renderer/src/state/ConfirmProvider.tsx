import { createContext, useState, useSyncExternalStore } from 'react'
import type React from 'react'
import { ConfirmDialog } from '../components/ui'
import { createConfirmQueue, type ConfirmAnswer, type ConfirmRequest } from '../logic/confirm-queue'
import { useRequiredContext } from './context'

/** Ask the user to confirm; resolves true when confirmed and false when cancelled. */
export type Confirm = (request: ConfirmRequest) => Promise<boolean>
/** Ask the user to pick: the confirming action, the request's `alternative`, or cancel. */
export type Choose = (request: ConfirmRequest) => Promise<ConfirmAnswer>

const ConfirmContext = createContext<{ confirm: Confirm; choose: Choose } | null>(null)

/** In-app confirmation dialogs: native confirm() blocks the whole window and cannot be styled. */
export function ConfirmProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [queue] = useState(() => createConfirmQueue<ConfirmRequest, ConfirmAnswer>())
  const [value] = useState(() => ({
    confirm: async (request: ConfirmRequest) => (await queue.enqueue(request)) === 'confirm',
    choose: (request: ConfirmRequest) => queue.enqueue(request)
  }))
  const active = useSyncExternalStore(queue.subscribe, queue.current)

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {/* Rendered after the app, so it paints over any dialog that asked for the confirmation. */}
      {active && (
        <ConfirmDialog
          key={active.id}
          title={active.request.title}
          message={active.request.message}
          confirmLabel={active.request.confirmLabel}
          danger={active.request.danger}
          alternative={active.request.alternative}
          onConfirm={() => queue.settle('confirm')}
          onAlternative={() => queue.settle('alternative')}
          onCancel={() => queue.settle('cancel')}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = (): Confirm => useRequiredContext(ConfirmContext, 'useConfirm').confirm

export const useChoose = (): Choose => useRequiredContext(ConfirmContext, 'useChoose').choose
