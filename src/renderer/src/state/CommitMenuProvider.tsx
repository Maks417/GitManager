import { createContext, useCallback, useMemo, useState } from 'react'
import type React from 'react'
import type { Commit } from '@shared/ipc'
import { ContextMenu, type MenuItem } from '../components/ui'
import { CreateBranchModal } from '../features/branches/CreateBranchModal'
import { ResetModal } from '../features/commit-actions/ResetModal'
import { TagModal } from '../features/commit-actions/TagModal'
import { CompareModal } from '../features/comparison/CompareModal'
import {
  confirmCheckoutCommit,
  confirmCherryPick,
  confirmDeleteTag,
  confirmMerge,
  confirmRebase,
  confirmRevert
} from '../lib/copy'
import { useAppStatus } from './AppStatusProvider'
import { useConfirm } from './ConfirmProvider'
import { useRequiredContext } from './context'
import { useGitActions } from './GitActionsProvider'
import { useHistoryState } from './HistoryProvider'
import { useSession, useStatus } from './RepoSessionProvider'

export interface CommitMenu {
  /** Open the actions menu of `commit` at a viewport point. */
  openCommitMenu: (commit: Commit, point: { x: number; y: number }) => void
}

type CommitDialog = { kind: 'branch' | 'tag' | 'reset' | 'compare'; commit: Commit } | null

const CommitMenuContext = createContext<CommitMenu | null>(null)

/**
 * The actions on one commit, for the History list (right-click, Shift+F10) and the commit pane's More menu:
 * check out, branch and tag here, merge, rebase, cherry-pick, revert, reset, tags, copy.
 */
export function CommitMenuProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { busy } = useAppStatus()
  const { activeRepo, currentBranch, rebaseInProgress, mergeInProgress, sequencerOp } = useSession()
  const { status } = useStatus()
  const { headSha } = useHistoryState()
  const actions = useGitActions()
  const confirm = useConfirm()
  const [menu, setMenu] = useState<{ commit: Commit; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<CommitDialog>(null)

  const openCommitMenu = useCallback((commit: Commit, point: { x: number; y: number }): void => {
    setMenu({ commit, ...point })
  }, [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  const branch = currentBranch?.name ?? null
  const onto = branch ?? 'HEAD'

  const itemsFor = (commit: Commit): MenuItem[] => {
    const short = commit.shortSha
    const isHead = commit.sha === headSha
    // Another merge, rebase, cherry-pick or revert must finish first.
    const blocked = busy || rebaseInProgress || mergeInProgress || sequencerOp !== null
    const hasRemote = (activeRepo?.remotes.length ?? 0) > 0
    const tags = commit.refs.filter((r) => r.type === 'tag').map((r) => r.name)
    const afterConfirm = (request: Parameters<typeof confirm>[0], then: () => void) => (): void => {
      void confirm(request).then((ok) => {
        if (ok) then()
      })
    }

    const items: MenuItem[] = [
      {
        label: 'Check out this commit',
        disabled: busy || isHead,
        onSelect: afterConfirm(confirmCheckoutCommit(short), () => void actions.checkoutBranch(commit.sha))
      },
      { label: 'Compare with HEAD…', disabled: !headSha, onSelect: () => setDialog({ kind: 'compare', commit }) },
      { label: 'New branch here…', separatorBefore: true, onSelect: () => setDialog({ kind: 'branch', commit }) },
      { label: 'New tag here…', onSelect: () => setDialog({ kind: 'tag', commit }) },
      {
        label: `Merge into ${onto}…`,
        separatorBefore: true,
        disabled: blocked || isHead,
        onSelect: afterConfirm(confirmMerge(short), () => void actions.runMergeOrRebase('merge', commit.sha))
      },
      {
        label: `Rebase ${onto} onto this…`,
        disabled: blocked || isHead,
        onSelect: afterConfirm(confirmRebase(short), () => void actions.runMergeOrRebase('rebase', commit.sha))
      },
      {
        label: `Cherry-pick onto ${onto}…`,
        disabled: blocked || isHead,
        onSelect: afterConfirm(confirmCherryPick(short, commit.subject, onto), () =>
          void actions.runMergeOrRebase('cherryPick', commit.sha)
        )
      },
      {
        label: 'Revert…',
        disabled: blocked,
        onSelect: afterConfirm(confirmRevert(short, commit.subject, onto), () =>
          void actions.runMergeOrRebase('revert', commit.sha)
        )
      },
      {
        label: `Reset ${onto} to here…`,
        danger: true,
        disabled: blocked || isHead,
        onSelect: () => setDialog({ kind: 'reset', commit })
      }
    ]
    tags.forEach((tag, index) => {
      if (hasRemote) {
        items.push({
          label: `Push tag ${tag}`,
          separatorBefore: index === 0,
          disabled: busy,
          onSelect: () => void actions.pushTag(tag, false)
        })
      }
      items.push({
        label: `Delete tag ${tag}…`,
        danger: true,
        separatorBefore: index === 0 && !hasRemote,
        disabled: busy,
        onSelect: afterConfirm(confirmDeleteTag(tag, false), () => void actions.deleteTag(tag))
      })
      if (hasRemote) {
        items.push({
          label: `Delete tag ${tag} on remote…`,
          danger: true,
          disabled: busy,
          onSelect: afterConfirm(confirmDeleteTag(tag, true), () => void actions.pushTag(tag, true))
        })
      }
    })
    items.push(
      {
        label: 'Copy SHA',
        separatorBefore: true,
        onSelect: () => void navigator.clipboard.writeText(commit.sha)
      },
      {
        label: 'Copy message',
        onSelect: () =>
          void navigator.clipboard.writeText(commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject)
      }
    )
    return items
  }

  const value = useMemo<CommitMenu>(() => ({ openCommitMenu }), [openCommitMenu])
  const lead = (commit: Commit): React.ReactNode => (
    <>
      At <span className="sha">{commit.shortSha}</span> {commit.subject}
    </>
  )

  return (
    <CommitMenuContext.Provider value={value}>
      {children}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={`Actions for commit ${menu.commit.shortSha}`}
          items={itemsFor(menu.commit)}
          onClose={closeMenu}
        />
      )}
      {dialog?.kind === 'branch' && (
        <CreateBranchModal
          lead={lead(dialog.commit)}
          onClose={closeDialog}
          onCreate={(name, checkout) => actions.createBranch(name, checkout, dialog.commit.sha)}
        />
      )}
      {dialog?.kind === 'compare' && activeRepo && <CompareModal repoPath={activeRepo.path} refs={[]} initialBase={dialog.commit.sha} initialTarget={headSha ?? 'HEAD'} snapshots onClose={closeDialog} />}
      {dialog?.kind === 'tag' && (
        <TagModal
          commit={dialog.commit}
          onClose={closeDialog}
          onCreate={(name, message) => actions.createTag(name, dialog.commit.sha, message || undefined)}
        />
      )}
      {dialog?.kind === 'reset' && activeRepo && (
        <ResetModal
          commit={dialog.commit}
          repoPath={activeRepo.path}
          branch={branch}
          changedFiles={status.length}
          onClose={closeDialog}
          onReset={(mode) => actions.resetTo(dialog.commit.sha, mode)}
        />
      )}
    </CommitMenuContext.Provider>
  )
}

export const useCommitMenu = (): CommitMenu => useRequiredContext(CommitMenuContext, 'useCommitMenu')
