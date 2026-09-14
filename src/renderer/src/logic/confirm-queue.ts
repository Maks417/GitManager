export interface ConfirmRequest {
  title: string
  message: string
  /** Label of the confirming button; defaults to "Confirm". */
  confirmLabel?: string
  /** Style the confirming button as destructive. */
  danger?: boolean
}

export interface QueuedConfirm<T> {
  id: number
  request: T
}

/** Confirmation requests, shown one at a time in the order they were made. */
export interface ConfirmQueue<T> {
  /** Resolves true when confirmed, false when cancelled. */
  enqueue(request: T): Promise<boolean>
  /** The request to show now: the same object until it is settled. */
  current(): QueuedConfirm<T> | null
  /** Answer the current request and move on to the next one. */
  settle(confirmed: boolean): void
  subscribe(listener: () => void): () => void
}

export function createConfirmQueue<T>(): ConfirmQueue<T> {
  const pending: (QueuedConfirm<T> & { resolve: (confirmed: boolean) => void })[] = []
  const listeners = new Set<() => void>()
  let nextId = 1
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    enqueue(request) {
      return new Promise<boolean>((resolve) => {
        pending.push({ id: nextId++, request, resolve })
        if (pending.length === 1) notify()
      })
    },
    current: () => pending[0] ?? null,
    settle(confirmed) {
      const head = pending.shift()
      if (!head) return
      head.resolve(confirmed)
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
