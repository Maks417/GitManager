import { describe, expect, it } from 'vitest'
import { createConfirmQueue } from '../src/renderer/src/logic/confirm-queue'

describe('createConfirmQueue', () => {
  it('shows requests one at a time, in order, and resolves each with its answer', async () => {
    const queue = createConfirmQueue<string>()
    let notified = 0
    queue.subscribe(() => notified++)

    const discard = queue.enqueue('discard')
    const dropStash = queue.enqueue('drop stash')
    expect(queue.current()?.request).toBe('discard')
    expect(notified).toBe(1)

    queue.settle(false)
    expect(queue.current()?.request).toBe('drop stash')
    queue.settle(true)
    expect(queue.current()).toBeNull()
    expect(notified).toBe(3)

    await expect(discard).resolves.toBe(false)
    await expect(dropStash).resolves.toBe(true)
  })

  it('returns the same snapshot until the request is settled', () => {
    const queue = createConfirmQueue<string>()
    void queue.enqueue('merge')
    expect(queue.current()).toBe(queue.current())
  })

  it('ignores an answer when nothing is waiting', () => {
    const queue = createConfirmQueue<string>()
    expect(() => queue.settle(true)).not.toThrow()
    expect(queue.current()).toBeNull()
  })
})
