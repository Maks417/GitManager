export const IpcChannels = {
  repo: {
    list: 'repo:list',
    add: 'repo:add',
    remove: 'repo:remove',
    openDialog: 'repo:open-dialog',
    create: 'repo:create',
    clone: 'repo:clone',
    get: 'repo:get',
    status: 'repo:status',
    branches: 'repo:branches',
    remoteBranches: 'repo:remote-branches',
    pickDirectory: 'repo:pick-directory',
    watch: 'repo:watch',
    unwatch: 'repo:unwatch',
    onChanged: 'repo:on-changed'
  },
  history: {
    load: 'history:load',
    commitDetail: 'history:commit-detail',
    fileDiff: 'history:file-diff',
    workingTreeDiff: 'history:working-tree-diff'
  },
  git: {
    probe: 'git:probe',
    stage: 'git:stage',
    unstage: 'git:unstage',
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
    stash: 'git:stash',
    stashList: 'git:stash-list',
    stashApply: 'git:stash-apply',
    stashPop: 'git:stash-pop',
    stashDrop: 'git:stash-drop',
    discard: 'git:discard',
    getIdentity: 'git:get-identity',
    setIdentity: 'git:set-identity'
  },
  merge: {
    listConflicts: 'merge:list-conflicts',
    getSides: 'merge:get-sides',
    saveResult: 'merge:save-result'
  },
  providers: {
    listAccounts: 'providers:list-accounts',
    connect: 'providers:connect',
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
    openPath: 'shell:open-path',
    showItemInFolder: 'shell:show-item-in-folder'
  }
} as const
