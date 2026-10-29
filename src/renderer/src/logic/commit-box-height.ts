/** Limits of the commit message box's resting height (keep in sync with AppPreferencesSchema). */
export const COMMIT_BOX_MIN = 48
export const COMMIT_BOX_MAX = 600

/** Height the file list keeps however tall the message box gets. */
const FILE_LIST_MIN = 120
/** Share of the room a long message grows the box into by itself. */
const GROW_SHARE = 0.5

/**
 * The tallest the splitter may make the box, given the room the box and the file list share; an unmeasured
 * room (0) sets no limit.
 */
export function commitBoxMax(room: number): number {
  if (room <= 0) return COMMIT_BOX_MAX
  return Math.max(COMMIT_BOX_MIN, Math.min(COMMIT_BOX_MAX, room - FILE_LIST_MIN))
}

export interface CommitBoxSize {
  /** Height the message needs, borders included. */
  content: number
  /** The height set with the splitter. */
  resting: number
  /** Height the message box and the file list share; 0 before it is measured. */
  room: number
  /** The splitter made the box smaller than the message: keep that size and scroll. */
  pinned: boolean
}

/**
 * Height of the commit message box: the resting height, grown with the message up to half the room it shares
 * with the file list, then scrolling. A box dragged smaller than its message stays that size.
 */
export function commitBoxHeight({ content, resting, room, pinned }: CommitBoxSize): number {
  const base = Math.min(resting, commitBoxMax(room))
  if (pinned) return base
  const cap = room > 0 ? Math.max(base, Math.floor(room * GROW_SHARE)) : base
  return Math.max(base, Math.min(content, cap))
}
