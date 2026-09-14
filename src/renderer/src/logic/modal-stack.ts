/** Open dialogs, bottom to top. Only the top one reacts to Escape and traps focus. */
export interface ModalStack {
  push(id: symbol): void
  remove(id: symbol): void
  isTop(id: symbol): boolean
}

export function createModalStack(): ModalStack {
  const ids: symbol[] = []
  return {
    push: (id) => {
      ids.push(id)
    },
    remove: (id) => {
      const index = ids.lastIndexOf(id)
      if (index >= 0) ids.splice(index, 1)
    },
    isTop: (id) => ids.length > 0 && ids[ids.length - 1] === id
  }
}
