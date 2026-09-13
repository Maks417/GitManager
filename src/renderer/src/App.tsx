import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { ProviderAccount, RemoteRepo, UpdateStatus } from '@shared/ipc'
import { MenuChannels } from '@shared/ipc'
import { AccountsModal } from './features/accounts/AccountsModal'
import { CloneModal } from './features/clone/CloneModal'
import { AboutModal } from './features/about/AboutModal'
import { UpdatesModal } from './features/updates/UpdatesModal'
import { IdentityModal } from './features/identity/IdentityModal'
import { CreateBranchModal } from './features/branches/CreateBranchModal'
import { BranchPickModal } from './features/branches/BranchPickModal'
import { MergeEditorModal } from './features/merge-editor/MergeEditorModal'
import { ConfirmDialog } from './components/ui'
import { CLONE_URL_SESSION_KEY } from './lib/copy'
import { toErrorMessage } from './lib/errors'
import { runWithBusy } from './lib/useAsyncAction'
import { useLayoutPrefs } from './hooks/useLayoutPrefs'
import { useHistory } from './hooks/useHistory'
import { useRepoSession, type HistoryFns } from './hooks/useRepoSession'
import { useWorkingTree, useWorkingTreeState } from './hooks/useWorkingTree'
import { AppToolbar } from './shell/AppToolbar'
import { WelcomeScreen } from './shell/WelcomeScreen'
import { WorkspaceShell } from './shell/WorkspaceShell'

export function App(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [mergePickOpen, setMergePickOpen] = useState(false)
  const [rebasePickOpen, setRebasePickOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const historyFnsRef = useRef<HistoryFns | null>(null)

  const layout = useLayoutPrefs()
  const wt = useWorkingTreeState()

  const session = useRepoSession({
    setError,
    hydrateFromPrefs: layout.hydrateFromPrefs,
    setAccounts,
    setUpdateStatus,
    historyFnsRef,
    setSelection: wt.setSelection,
    setViewMode: wt.setViewMode,
    liveStatusWatch: layout.prefs?.liveStatusWatch,
    onConflictsDetected: () => setMergeOpen(true)
  })

  const history = useHistory({
    activeRepo: session.activeRepo,
    search,
    historyFilter: layout.prefs?.historyFilter,
    busy,
    setBusy,
    setError,
    setSelection: wt.setSelection,
    setViewMode: wt.setViewMode,
    setDetail: wt.setDetail,
    setSelectedFile: wt.setSelectedFile,
    setDiff: wt.setDiff,
    setRemoteBranches: session.setRemoteBranches,
    refreshRepoMeta: session.refreshRepoMeta
  })

  historyFnsRef.current = {
    loadHistory: history.loadHistory,
    refreshHistoryTip: history.refreshHistoryTip
  }

  const working = useWorkingTree({
    ...wt,
    activeRepo: session.activeRepo,
    status: session.status,
    commits: history.commits,
    headSha: history.headSha,
    setError
  })

  const requireGit = useCallback((): boolean => {
    if (!session.gitMissing) return true
    setError(
      (prev) =>
        prev ||
        'Git was not found on this computer. Install Git from https://git-scm.com/downloads, then restart Git Manager.'
    )
    return false
  }, [session.gitMissing])

  const openClone = useCallback((): void => {
    if (!requireGit()) return
    setCloneOpen(true)
  }, [requireGit])

  const addRepo = useCallback(async (): Promise<void> => {
    if (!requireGit()) return
    await runWithBusy(
      async () => {
        const repo = await window.gitManager.repo.openDialog()
        if (!repo) return
        await session.refreshRepos()
        session.setActiveRepo(repo)
        wt.setSelection(null)
        wt.setViewMode('history')
      },
      { setError }
    )
  }, [requireGit, session, wt])

  const runGit = useCallback(
    async (op: 'fetch' | 'pull' | 'push'): Promise<void> => {
      if (!session.activeRepo) return
      await runWithBusy(
        async () => {
          await window.gitManager.git[op](session.activeRepo!.path)
          await session.refreshRepoMeta(session.activeRepo!)
          await history.refreshHistoryTip(session.activeRepo!)
        },
        { setBusy, setError }
      )
    },
    [session, history]
  )

  const runMergeOrRebase = useCallback(
    async (op: 'merge' | 'rebase', ref: string): Promise<void> => {
      if (!session.activeRepo) return
      await runWithBusy(
        async () => {
          try {
            const result =
              op === 'merge'
                ? await window.gitManager.git.merge(session.activeRepo!.path, ref)
                : await window.gitManager.git.rebase(session.activeRepo!.path, ref)
            await session.afterGitMutation({ history: 'full' })
            if (result.conflicts.length > 0) setMergeOpen(true)
          } catch (err) {
            await session.afterGitMutation({ history: 'full' }).catch(() => undefined)
            throw err
          }
        },
        { setBusy, setError }
      )
    },
    [session]
  )

  const deleteBranch = useCallback(
    async (name: string): Promise<void> => {
      if (!session.activeRepo) return
      await runWithBusy(
        async () => {
          try {
            await window.gitManager.git.deleteBranch(session.activeRepo!.path, name, false)
          } catch (err) {
            const msg = toErrorMessage(err)
            if (!confirm(`${msg}\n\nForce delete branch "${name}"?`)) throw err
            await window.gitManager.git.deleteBranch(session.activeRepo!.path, name, true)
          }
          await session.afterGitMutation({ history: 'full' })
        },
        { setBusy, setError }
      )
    },
    [session]
  )

  const checkoutRemote = useCallback(
    async (remoteRef: string): Promise<void> => {
      if (!session.activeRepo || busy) return
      await runWithBusy(
        async () => {
          await window.gitManager.git.checkoutRemoteBranch(session.activeRepo!.path, remoteRef)
          await session.afterGitMutation({ history: 'full' })
        },
        { setBusy, setError }
      )
    },
    [session, busy]
  )

  useEffect(() => {
    if (!window.gitManagerMenu) return
    const offs = [
      window.gitManagerMenu.on(MenuChannels.addRepo, () => void addRepo()),
      window.gitManagerMenu.on(MenuChannels.cloneRepo, () => openClone()),
      window.gitManagerMenu.on(MenuChannels.accounts, () => setAccountsOpen(true)),
      window.gitManagerMenu.on(MenuChannels.identity, () => setIdentityOpen(true)),
      window.gitManagerMenu.on(MenuChannels.createBranch, () => setCreateBranchOpen(true)),
      window.gitManagerMenu.on(MenuChannels.merge, () => setMergePickOpen(true)),
      window.gitManagerMenu.on(MenuChannels.rebase, () => setRebasePickOpen(true)),
      window.gitManagerMenu.on(MenuChannels.focusSearch, () => searchRef.current?.focus()),
      window.gitManagerMenu.on(MenuChannels.fetch, () => void runGit('fetch')),
      window.gitManagerMenu.on(MenuChannels.pull, () => void runGit('pull')),
      window.gitManagerMenu.on(MenuChannels.push, () => void runGit('push')),
      window.gitManagerMenu.on(MenuChannels.updates, () => setUpdatesOpen(true)),
      window.gitManagerMenu.on(MenuChannels.about, () => setAboutOpen(true)),
      window.gitManagerMenu.on(MenuChannels.viewHistory, () => working.goHistory()),
      window.gitManagerMenu.on(MenuChannels.viewChanges, () => working.selectWorkingCopy()),
      window.gitManagerMenu.on(MenuChannels.toggleDock, () => layout.toggleDock()),
      window.gitManagerMenu.on(MenuChannels.toggleSidebar, () => layout.toggleSidebar())
    ]
    return () => offs.forEach((off) => off())
  })

  const onSearchSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (session.activeRepo) void history.loadHistory(session.activeRepo, search)
  }

  const conflictCount = session.status.filter((s) => s.conflicted).length
  const activeRepo = session.activeRepo

  return (
    <div className="app-shell">
      <AppToolbar
        activeRepo={Boolean(activeRepo)}
        busy={busy}
        viewMode={wt.viewMode}
        statusCount={session.status.length}
        conflictCount={conflictCount}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={onSearchSubmit}
        searchRef={searchRef}
        currentBranch={session.currentBranch}
        theme={layout.prefs?.theme ?? 'system'}
        onThemeChange={layout.setThemePref}
        onGoHistory={working.goHistory}
        onSelectWorkingCopy={working.selectWorkingCopy}
        onResolveConflicts={() => setMergeOpen(true)}
        onFetch={() => void runGit('fetch')}
        onPull={() => void runGit('pull')}
        onPush={() => void runGit('push')}
      />

      {!activeRepo ? (
        <WelcomeScreen
          error={error}
          gitMissing={session.gitMissing}
          onAddRepo={() => void addRepo()}
          onClone={openClone}
          onAccounts={() => setAccountsOpen(true)}
        />
      ) : (
        <WorkspaceShell
          activeRepo={activeRepo}
          repos={session.repos}
          branches={session.branches}
          remoteBranches={session.remoteBranches}
          currentBranch={session.currentBranch}
          localBranchNames={session.localBranchNames}
          sidebarCollapsed={layout.sidebarCollapsed}
          branchesExpanded={layout.branchesExpanded}
          remoteBranchesExpanded={layout.remoteBranchesExpanded}
          sidebarWidth={layout.sidebarWidth}
          setSidebarWidth={layout.setSidebarWidth}
          inspectorHeight={layout.inspectorHeight}
          setInspectorHeight={layout.setInspectorHeight}
          detailWidth={layout.detailWidth}
          setDetailWidth={layout.setDetailWidth}
          inspectorFilesWidth={layout.inspectorFilesWidth}
          setInspectorFilesWidth={layout.setInspectorFilesWidth}
          changesFilesWidth={layout.changesFilesWidth}
          setChangesFilesWidth={layout.setChangesFilesWidth}
          historyGraphColWidth={layout.historyGraphColWidth}
          setHistoryGraphColWidth={layout.setHistoryGraphColWidth}
          historyDateColWidth={layout.historyDateColWidth}
          setHistoryDateColWidth={layout.setHistoryDateColWidth}
          historyAuthorColWidth={layout.historyAuthorColWidth}
          setHistoryAuthorColWidth={layout.setHistoryAuthorColWidth}
          persistLayout={layout.persistLayout}
          detailDock={layout.detailDock}
          viewMode={wt.viewMode}
          selection={wt.selection}
          selectedSha={wt.selectedSha}
          commits={history.commits}
          graphBySha={history.graphBySha}
          headSha={history.headSha}
          busy={busy}
          historyLoadingMore={history.historyLoadingMore}
          nextCursor={history.nextCursor}
          historyFilter={layout.prefs?.historyFilter || 'all'}
          onHistoryFilterChange={layout.setHistoryFilter}
          onLoadMoreHistory={() => void history.loadMoreHistory()}
          onSelectCommit={working.selectCommit}
          detail={wt.detail}
          selectedFile={wt.selectedFile}
          setSelectedFile={wt.setSelectedFile}
          diff={wt.diff}
          diffLoading={wt.diffLoading}
          status={session.status}
          focusedStatusPath={wt.focusedStatusPath}
          setFocusedStatusPath={wt.setFocusedStatusPath}
          diffSide={wt.diffSide}
          setDiffSide={wt.setDiffSide}
          identity={session.identity}
          rebaseInProgress={session.rebaseInProgress}
          error={error}
          onToggleSidebar={layout.toggleSidebar}
          onToggleBranches={layout.toggleBranches}
          onToggleRemoteBranches={layout.toggleRemoteBranches}
          onToggleDock={layout.toggleDock}
          onSelectRepo={(repo) => {
            session.setActiveRepo(repo)
            wt.setSelection(null)
            wt.setViewMode('history')
          }}
          onRequestRemove={(repo) => {
            session.setRepoRemoveError(null)
            session.setRepoPendingRemove(repo)
          }}
          onCreateBranch={() => setCreateBranchOpen(true)}
          onCheckoutBranch={(name) => {
            void window.gitManager.git.checkout(activeRepo.path, name).then(async () => {
              await session.afterGitMutation({ history: 'full' })
            })
          }}
          onMergeBranch={(name) => void runMergeOrRebase('merge', name)}
          onRebaseOnto={(name) => void runMergeOrRebase('rebase', name)}
          onDeleteBranch={(name) => void deleteBranch(name)}
          onCheckoutRemote={(ref) => void checkoutRemote(ref)}
          onMergeCommit={(sha) => void runMergeOrRebase('merge', sha)}
          onRebaseOntoCommit={(sha) => void runMergeOrRebase('rebase', sha)}
          onRefreshWorkingTree={() => session.afterGitMutation({ history: 'tip' })}
          onError={setError}
          onBrowseHistory={working.goHistory}
          onEditIdentity={() => setIdentityOpen(true)}
          onRebaseContinue={async () => {
            const result = await window.gitManager.git.rebaseContinue(activeRepo.path)
            await session.afterGitMutation({ history: 'full' })
            if (result.conflicts.length > 0) setMergeOpen(true)
          }}
          onRebaseAbort={async () => {
            await window.gitManager.git.rebaseAbort(activeRepo.path)
            await session.afterGitMutation({ history: 'full' })
          }}
        />
      )}

      {session.repoPendingRemove && (
        <ConfirmDialog
          title="Remove repository"
          message={`Remove “${session.repoPendingRemove.name}” from the list?`}
          checkboxLabel="Also delete files from disk"
          confirmLabel="Remove"
          confirmLabelChecked="Delete from disk"
          danger
          busy={session.repoRemoveBusy}
          error={session.repoRemoveError}
          onCancel={() => {
            if (session.repoRemoveBusy) return
            session.setRepoPendingRemove(null)
            session.setRepoRemoveError(null)
          }}
          onConfirm={({ checked }) =>
            void session.removeRepoFromList(session.repoPendingRemove!, checked)
          }
        />
      )}
      {accountsOpen && (
        <AccountsModal
          accounts={accounts}
          onClose={() => setAccountsOpen(false)}
          onChanged={async () => setAccounts(await window.gitManager.providers.listAccounts())}
          onCloneRemote={(repo: RemoteRepo) => {
            if (!requireGit()) return
            setAccountsOpen(false)
            setCloneOpen(true)
            sessionStorage.setItem(CLONE_URL_SESSION_KEY, repo.cloneUrlHttps)
          }}
        />
      )}
      {cloneOpen && (
        <CloneModal
          onClose={() => setCloneOpen(false)}
          onCloned={async (repo) => {
            await session.refreshRepos()
            session.setActiveRepo(repo)
            setCloneOpen(false)
            wt.setSelection(null)
            wt.setViewMode('history')
          }}
        />
      )}
      {updatesOpen && (
        <UpdatesModal
          status={updateStatus}
          onClose={() => setUpdatesOpen(false)}
          onStatus={setUpdateStatus}
        />
      )}
      {aboutOpen && (
        <AboutModal
          status={updateStatus}
          onClose={() => setAboutOpen(false)}
          onStatus={setUpdateStatus}
        />
      )}
      {identityOpen && activeRepo && (
        <IdentityModal
          repoPath={activeRepo.path}
          onClose={() => setIdentityOpen(false)}
          onSaved={session.setIdentity}
        />
      )}
      {createBranchOpen && activeRepo && (
        <CreateBranchModal
          onClose={() => setCreateBranchOpen(false)}
          onCreate={async (name, checkout) => {
            await window.gitManager.git.createBranch(activeRepo.path, name, checkout)
            await session.afterGitMutation({ history: 'full' })
          }}
        />
      )}
      {mergePickOpen && activeRepo && (
        <BranchPickModal
          title="Merge branch"
          confirmVerb="Merge"
          description={`Merge the selected branch into ${session.currentBranch?.name || activeRepo.currentBranch || 'HEAD'}.`}
          branches={session.branches}
          onClose={() => setMergePickOpen(false)}
          onPick={async (name) => {
            await runMergeOrRebase('merge', name)
          }}
        />
      )}
      {rebasePickOpen && activeRepo && (
        <BranchPickModal
          title="Rebase onto"
          confirmVerb="Rebase"
          description={`Rebase ${session.currentBranch?.name || activeRepo.currentBranch || 'HEAD'} onto the selected branch.`}
          branches={session.branches}
          onClose={() => setRebasePickOpen(false)}
          onPick={async (name) => {
            await runMergeOrRebase('rebase', name)
          }}
        />
      )}
      {mergeOpen && activeRepo && (
        <MergeEditorModal
          repoPath={activeRepo.path}
          rebaseInProgress={session.rebaseInProgress}
          onClose={() => setMergeOpen(false)}
          onResolved={() => session.afterGitMutation({ history: 'full' })}
          onRebaseContinue={async () => {
            const result = await window.gitManager.git.rebaseContinue(activeRepo.path)
            await session.afterGitMutation({ history: 'full' })
            if (result.conflicts.length === 0) setMergeOpen(false)
          }}
          onRebaseAbort={async () => {
            await window.gitManager.git.rebaseAbort(activeRepo.path)
            await session.afterGitMutation({ history: 'full' })
          }}
        />
      )}
    </div>
  )
}
