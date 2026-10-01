export interface ConfirmRequest {
  title: string
  message: string
  /** Label of the confirming button; defaults to "Confirm". */
  confirmLabel?: string
  /** Style the confirming button as destructive. */
  danger?: boolean
  /** A second way forward, shown between Cancel and the confirming button. */
  alternative?: { label: string; danger?: boolean }
}

/** What the user picked in a dialog with an alternative. */
export type ConfirmAnswer = 'confirm' | 'alternative' | 'cancel'

export interface QueuedConfirm<T> {
  id: number
  request: T
}

/** Confirmation requests, shown one at a time in the order they were made. */
export interface ConfirmQueue<T, A = boolean> {
  /** Resolves with the answer, e.g. true when confirmed and false when cancelled. */
  enqueue(request: T): Promise<A>
  /** The request to show now: the same object until it is settled. */
  current(): QueuedConfirm<T> | null
  /** Answer the current request and move on to the next one. */
  settle(answer: A): void
  subscribe(listener: () => void): () => void
}

export function createConfirmQueue<T, A = boolean>(): ConfirmQueue<T, A> {
  const pending: (QueuedConfirm<T> & { resolve: (answer: A) => void })[] = []
  const listeners = new Set<() => void>()
  let nextId = 1
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    enqueue(request) {
      return new Promise<A>((resolve) => {
        pending.push({ id: nextId++, request, resolve })
        if (pending.length === 1) notify()
      })
    },
    current: () => pending[0] ?? null,
    settle(answer) {
      const head = pending.shift()
      if (!head) return
      head.resolve(answer)
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
