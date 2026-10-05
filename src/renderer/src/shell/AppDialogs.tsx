import { useEffect } from 'react'
import type React from 'react'
import { AboutModal } from '../features/about/AboutModal'
import { AccountsModal } from '../features/accounts/AccountsModal'
import { BranchPickModal } from '../features/branches/BranchPickModal'
import { BranchTrackingModal } from '../features/branches/BranchTrackingModal'
import { CreateBranchModal } from '../features/branches/CreateBranchModal'
import { CloneModal } from '../features/clone/CloneModal'
import { IdentityModal } from '../features/identity/IdentityModal'
import { MergeEditorModal } from '../features/merge-editor/MergeEditorModal'
import { NewRepoModal } from '../features/repositories/NewRepoModal'
import { RemoveRepoDialog } from '../features/repositories/RemoveRepoDialog'
import { UpdatesModal } from '../features/updates/UpdatesModal'
import { RemotesModal } from '../features/remotes/RemotesModal'
import { PublishBranchModal } from '../features/remotes/PublishBranchModal'
import { CompareModal } from '../features/comparison/CompareModal'
import { RecoveryModal } from '../features/recovery/RecoveryModal'
import { CLONE_URL_SESSION_KEY } from '../lib/copy'
import { sameRepoPath } from '../lib/paths'
import { useAppStatus, useAppStatusActions } from '../state/AppStatusProvider'
import { useDialogActions, useDialogState } from '../state/DialogsProvider'
import { useGitActions } from '../state/GitActionsProvider'
import { useSession, useSessionActions } from '../state/RepoSessionProvider'

/** Branch actions keep their target instead of following a later repository or checkout change. */
function BranchDialogs(): React.JSX.Element | null {
  const { branchDialog: target } = useDialogState()
  const { closeBranchDialog } = useDialogActions()
  const { activeRepo, branches, remoteBranches } = useSession()
  const branch = branches.find((item) => item.name === target?.branchName)
  const valid = Boolean(target && activeRepo && sameRepoPath(target.repoPath, activeRepo.path) && branch && (target.kind === 'tracking' || branch.current))
  useEffect(() => {
    if (target && !valid) closeBranchDialog()
  }, [target, valid, closeBranchDialog])
  if (!valid || !target || !activeRepo || !branch) return null
  const key = `${target.repoPath}:${target.branchName}:${target.kind}`
  return target.kind === 'tracking'
    ? <BranchTrackingModal key={key} repo={activeRepo} branch={branch} remoteBranches={remoteBranches} onClose={closeBranchDialog} />
    : <PublishBranchModal key={key} repo={activeRepo} branch={branch} onClose={closeBranchDialog} />
}

/** Every modal of the app shell. Repository-scoped dialogs only mount while a repository is active. */
export function AppDialogs(): React.JSX.Element {
  const open = useDialogState()
  const { openDialog, closeDialog } = useDialogActions()
  const { accounts, updateStatus } = useAppStatus()
  const { setAccounts, setUpdateStatus } = useAppStatusActions()
  const {
    activeRepo,
    branches,
    remoteBranches,
    currentBranch,
    repoPendingRemove,
    repoRemoveBusy,
    repoRemoveError,
    repoRemoveWarning
  } = useSession()
  const {
    setRepoPendingRemove,
    setRepoRemoveError,
    setRepoRemoveWarning,
    removeRepoFromList,
    refreshRepos,
    setIdentity
  } = useSessionActions()
  const { requireGit, selectRepo, runMergeOrRebase, createBranch } = useGitActions()

  const branchLabel = currentBranch?.name || activeRepo?.currentBranch || 'HEAD'

  return (
    <>
      <BranchDialogs />
      {open.remotes && activeRepo && <RemotesModal key={activeRepo.path} repo={activeRepo} onClose={() => closeDialog('remotes')} />}
      {open.compare && activeRepo && <CompareModal key={activeRepo.path} repoPath={activeRepo.path} refs={[...branches.map((branch) => branch.name), ...remoteBranches.map((branch) => branch.name)]} onClose={() => closeDialog('compare')} />}
      {open.recovery && activeRepo && <RecoveryModal key={activeRepo.path} repoPath={activeRepo.path} onClose={() => closeDialog('recovery')} />}
      {repoPendingRemove && (
        <RemoveRepoDialog
          repo={repoPendingRemove}
          busy={repoRemoveBusy}
          error={repoRemoveError}
          warning={repoRemoveWarning}
          onCancel={() => {
            if (repoRemoveBusy) return
            setRepoPendingRemove(null)
            setRepoRemoveError(null)
            setRepoRemoveWarning(null)
          }}
          onConfirm={(options) => void removeRepoFromList(repoPendingRemove, options)}
        />
      )}
      {open.accounts && (
        <AccountsModal
          accounts={accounts}
          onClose={() => closeDialog('accounts')}
          onChanged={async () => setAccounts(await window.gitManager.providers.listAccounts())}
          onCloneRemote={(url) => {
            if (!requireGit()) return
            closeDialog('accounts')
            openDialog('clone')
            sessionStorage.setItem(CLONE_URL_SESSION_KEY, url)
          }}
        />
      )}
      {open.createRepo && (
        <NewRepoModal
          onClose={() => closeDialog('createRepo')}
          onCreated={async (repo) => {
            await refreshRepos()
            selectRepo(repo)
          }}
          onSetIdentity={() => {
            closeDialog('createRepo')
            openDialog('identity')
          }}
        />
      )}
      {open.clone && (
        <CloneModal
          onClose={() => closeDialog('clone')}
          onCloned={async (repo) => {
            await refreshRepos()
            selectRepo(repo)
            closeDialog('clone')
          }}
        />
      )}
      {open.updates && (
        <UpdatesModal status={updateStatus} onClose={() => closeDialog('updates')} onStatus={setUpdateStatus} />
      )}
      {open.about && (
        <AboutModal status={updateStatus} onClose={() => closeDialog('about')} onStatus={setUpdateStatus} />
      )}
      {open.identity && activeRepo && (
        <IdentityModal repoPath={activeRepo.path} onClose={() => closeDialog('identity')} onSaved={setIdentity} />
      )}
      {open.createBranch && activeRepo && (
        <CreateBranchModal onClose={() => closeDialog('createBranch')} onCreate={createBranch} />
      )}
      {open.mergePick && activeRepo && (
        <BranchPickModal
          title="Merge branch"
          confirmVerb="Merge"
          description={`Merge the selected branch into ${branchLabel}.`}
          branches={branches}
          onClose={() => closeDialog('mergePick')}
          onPick={(name) => runMergeOrRebase('merge', name)}
        />
      )}
      {open.rebasePick && activeRepo && (
        <BranchPickModal
          title="Rebase onto"
          confirmVerb="Rebase"
          description={`Rebase ${branchLabel} onto the selected branch.`}
          branches={branches}
          onClose={() => closeDialog('rebasePick')}
          onPick={(name) => runMergeOrRebase('rebase', name)}
        />
      )}
      {open.mergeEditor && activeRepo && <MergeEditorModal />}
    </>
  )
}
