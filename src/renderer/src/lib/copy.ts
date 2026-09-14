export const CONFIRM_ABORT_REBASE = 'Abort the in-progress rebase?'

export const CONFIRM_ABORT_MERGE =
  'Abort the merge? Conflict resolutions made so far are discarded and the branch returns to where it was before the merge.'

export const CONFIRM_MERGE = (ref: string): string => `Merge ${ref} into the current branch?`

export const CONFIRM_REBASE = (ref: string): string => `Rebase the current branch onto ${ref}?`

export const CLONE_URL_SESSION_KEY = 'gm.cloneUrl'

export const MONACO_FONT_FAMILY = 'IBM Plex Mono, Cascadia Code, Consolas, monospace'
