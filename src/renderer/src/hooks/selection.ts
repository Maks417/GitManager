export type Selection = { kind: 'commit'; sha: string } | { kind: 'working-copy' }
export type ViewMode = 'history' | 'changes'
export type HistoryRefreshMode = 'full' | 'tip' | 'none'
