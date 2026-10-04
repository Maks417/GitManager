export const MenuChannels = {
  newRepo: 'menu:new-repo',
  addRepo: 'menu:add-repo',
  cloneRepo: 'menu:clone-repo',
  accounts: 'menu:accounts',
  identity: 'menu:identity',
  remotes: 'menu:remotes',
  compare: 'menu:compare',
  recovery: 'menu:recovery',
  createBranch: 'menu:create-branch',
  merge: 'menu:merge',
  rebase: 'menu:rebase',
  focusSearch: 'menu:focus-search',
  fetch: 'menu:fetch',
  pull: 'menu:pull',
  push: 'menu:push',
  updates: 'menu:updates',
  about: 'menu:about',
  viewHistory: 'menu:view-history',
  viewChanges: 'menu:view-changes',
  toggleDock: 'menu:toggle-dock',
  toggleDiffView: 'menu:toggle-diff-view',
  toggleSyntaxHighlighting: 'menu:toggle-syntax-highlighting',
  toggleSidebar: 'menu:toggle-sidebar'
} as const

export type MenuChannel = (typeof MenuChannels)[keyof typeof MenuChannels]

export const IpcChannels = {
  repo: {
    list: 'repo:list',
    add: 'repo:add',
    remove: 'repo:remove',
    openDialog: 'repo:open-dialog',
    create: 'repo:create',
    inspectNewRepo: 'repo:inspect-new-repo',
    clone: 'repo:clone',
    get: 'repo:get',
    refresh: 'repo:refresh',
    status: 'repo:status',
    branches: 'repo:branches',
    remoteBranches: 'repo:remote-branches',
    pickDirectory: 'repo:pick-directory',
    watch: 'repo:watch',
    unwatch: 'repo:unwatch',
    onChanged: 'repo:on-changed',
    onWatchState: 'repo:on-watch-state',
    removalInfo: 'repo:removal-info',
    worktreeInfo: 'repo:worktree-info'
  },
  history: {
    load: 'history:load',
    commitDetail: 'history:commit-detail',
    fileDiff: 'history:file-diff',
    workingTreeDiff: 'history:working-tree-diff',
    fileHistory: 'history:file-history',
    blame: 'history:blame',
    compare: 'history:compare',
    compareDiff: 'history:compare-diff'
  },
  git: {
    probe: 'git:probe',
    remotes: 'git:remotes',
    saveRemote: 'git:save-remote',
    removeRemote: 'git:remove-remote',
    setUpstream: 'git:set-upstream',
    recovery: 'git:recovery',
    restoreRecovery: 'git:restore-recovery',
    deleteRecovery: 'git:delete-recovery',
    stage: 'git:stage',
    unstage: 'git:unstage',
    applyPartial: 'git:apply-partial',
    commit: 'git:commit',
    fetch: 'git:fetch',
    pull: 'git:pull',
    push: 'git:push',
    checkout: 'git:checkout',
    checkoutRemoteBranch: 'git:checkout-remote-branch',
    createBranch: 'git:create-branch',
    deleteBranch: 'git:delete-branch',
    merge: 'git:merge',
    rebase: 'git:rebase',
    rebaseContinue: 'git:rebase-continue',
    rebaseAbort: 'git:rebase-abort',
    rebaseInProgress: 'git:rebase-in-progress',
    rebaseSkip: 'git:rebase-skip',
    mergeAbort: 'git:merge-abort',
    mergeInProgress: 'git:merge-in-progress',
    cherryPick: 'git:cherry-pick',
    revert: 'git:revert',
    sequencerOp: 'git:sequencer-op',
    sequencerStep: 'git:sequencer-step',
    commitsAfter: 'git:commits-after',
    reset: 'git:reset',
    createTag: 'git:create-tag',
    deleteTag: 'git:delete-tag',
    pushTag: 'git:push-tag',
    stash: 'git:stash',
    stashList: 'git:stash-list',
    stashApply: 'git:stash-apply',
    stashPop: 'git:stash-pop',
    stashDrop: 'git:stash-drop',
    discard: 'git:discard',
    getIdentity: 'git:get-identity',
    setIdentity: 'git:set-identity',
    cancelOperation: 'git:cancel-operation',
    onProgress: 'git:on-progress'
  },
  merge: {
    listConflicts: 'merge:list-conflicts',
    getSides: 'merge:get-sides',
    saveResult: 'merge:save-result',
    resolveSide: 'merge:resolve-side'
  },
  providers: {
    listAccounts: 'providers:list-accounts',
    disconnect: 'providers:disconnect',
    listRepos: 'providers:list-repos',
    saveToken: 'providers:save-token'
  },
  prefs: {
    get: 'prefs:get',
    set: 'prefs:set'
  },
  updater: {
    status: 'updater:status',
    check: 'updater:check',
    install: 'updater:install',
    onStatus: 'updater:on-status'
  },
  app: {
    getInfo: 'app:get-info'
  },
  shell: {
    openExternal: 'shell:open-external',
    showInFolder: 'shell:show-in-folder'
  }
} as const
