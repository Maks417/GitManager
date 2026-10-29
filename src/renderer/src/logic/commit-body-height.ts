/** Limits of the Inspector's commit message height (keep in sync with AppPreferencesSchema). */
export const COMMIT_BODY_MIN = 40
export const COMMIT_BODY_MAX = 900

/** Height the file list and diff below keep however tall the message gets. */
const BELOW_MIN = 100

/**
 * The tallest the message may be shown, given the room it shares with the file list and diff below (0 while
 * unmeasured: no limit). The splitter also stops at `content`, the whole message, where taller only adds a gap.
 */
export function commitBodyMax(room: number, content = Infinity): number {
  const roomMax = room > 0 ? room - BELOW_MIN : COMMIT_BODY_MAX
  return Math.max(COMMIT_BODY_MIN, Math.min(COMMIT_BODY_MAX, content, roomMax))
}

/** The message is shown up to the height set with the splitter, within what the room allows. */
export function commitBodyMaxHeight(saved: number, room: number): number {
  return Math.min(saved, commitBodyMax(room))
}
