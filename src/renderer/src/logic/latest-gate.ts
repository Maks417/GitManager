/** Lets the newest of several overlapping async requests win: results of older ones are dropped. */
export interface LatestGate {
  /** Call when a request starts; check the returned token with `isLatest` when its result arrives. */
  begin(): number
  isLatest(token: number): boolean
}

export function createLatestGate(): LatestGate {
  let latest = 0
  return {
    begin: () => ++latest,
    isLatest: (token) => token === latest
  }
}
