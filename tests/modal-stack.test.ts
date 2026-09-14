import { describe, expect, it } from 'vitest'
import { createModalStack } from '../src/renderer/src/logic/modal-stack'

describe('createModalStack', () => {
  it('lets only the most recently opened dialog react', () => {
    const stack = createModalStack()
    const mergeEditor = Symbol('merge editor')
    const confirm = Symbol('confirm')
    stack.push(mergeEditor)
    expect(stack.isTop(mergeEditor)).toBe(true)

    stack.push(confirm)
    expect(stack.isTop(confirm)).toBe(true)
    expect(stack.isTop(mergeEditor)).toBe(false)

    stack.remove(confirm)
    expect(stack.isTop(mergeEditor)).toBe(true)
  })

  it('copes with dialogs closing out of order', () => {
    const stack = createModalStack()
    const lower = Symbol('lower')
    const upper = Symbol('upper')
    stack.push(lower)
    stack.push(upper)
    stack.remove(lower)
    expect(stack.isTop(upper)).toBe(true)
    stack.remove(upper)
    expect(stack.isTop(upper)).toBe(false)
  })
})
