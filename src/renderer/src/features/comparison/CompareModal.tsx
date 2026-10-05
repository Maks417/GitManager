import { useEffect, useState } from 'react'
import type React from 'react'
import type { Comparison, DiffResult } from '@shared/ipc'
import { Banner, Button, Field, FileStatusDot, Input, Modal } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { toErrorMessage } from '../../lib/errors'
import { nextListIndex } from '../../logic/list-nav'
import { useLayoutPrefsState } from '../../state/LayoutProvider'
import { DiffViewSwitch } from '../diff/DiffViewSwitch'
import { FileDiffViewer } from '../diff/FileDiffViewer'
import { SyntaxHighlightToggle } from '../diff/SyntaxHighlightToggle'

interface Props {
  repoPath: string
  refs: string[]
  initialBase?: string
  initialTarget?: string
  snapshots?: boolean
  onClose: () => void
}

export function CompareModal({ repoPath, refs, initialBase, initialTarget, snapshots, onClose }: Props): React.JSX.Element {
  const [base, setBase] = useState(initialBase ?? (refs.includes('main') ? 'main' : refs[0] ?? 'HEAD'))
  const [target, setTarget] = useState(initialTarget ?? 'HEAD')
  const [mergeBase, setMergeBase] = useState(!snapshots)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [selected, setSelected] = useState(0)
  const [diff, setDiff] = useState<{ key: string; result: DiffResult } | null>(null)
  const [diffError, setDiffError] = useState<{ key: string; message: string } | null>(null)
  const { busy, error, run } = useAsyncAction()
  const { diffView, syntaxHighlighting } = useLayoutPrefsState()
  const file = comparison?.files[selected]
  const diffKey = comparison && file ? `${comparison.baseSha}:${comparison.targetSha}:${file.path}:${file.oldPath ?? ''}` : ''

  useEffect(() => {
    if (!comparison || !file) return
    let cancelled = false
    window.gitManager.history.compareDiff({ repoPath, baseSha: comparison.baseSha, targetSha: comparison.targetSha, path: file.path, oldPath: file.oldPath }).then(
      (result) => { if (!cancelled) setDiff({ key: diffKey, result }) },
      (err) => { if (!cancelled) setDiffError({ key: diffKey, message: toErrorMessage(err) }) }
    )
    return () => { cancelled = true }
  }, [repoPath, comparison, file, diffKey])

  const compare = (): void => {
    void run(async () => {
      const result = await window.gitManager.history.compare({ repoPath, base: base.trim(), target: target.trim(), mergeBase })
      setComparison(result)
      setSelected(0)
      setDiff(null)
      setDiffError(null)
    })
  }
  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    const next = nextListIndex(e.key, selected, comparison?.files.length ?? 0)
    if (next === null) return
    e.preventDefault()
    setSelected(next)
    document.getElementById(`comparison-file-${next}`)?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <Modal title="Compare references" onClose={onClose} className="file-history-modal" bodyClassName="file-history-body"
      style={{ width: 'min(1200px, 96vw)', height: 'min(860px, 92vh)', display: 'flex', flexDirection: 'column' }}
      footer={<div className="modal-actions"><Button onClick={onClose}>Close</Button></div>}
    >
      {error && <Banner>{error}</Banner>}
      <div className="comparison-controls">
        <Field label="Base"><Input value={base} list="comparison-refs" onChange={(e) => setBase(e.target.value)} placeholder="Branch, tag or commit" onKeyDown={(e) => { if (e.key === 'Enter' && !busy && base.trim() && target.trim()) compare() }} /></Field>
        <Field label="Target"><Input value={target} list="comparison-refs" onChange={(e) => setTarget(e.target.value)} placeholder="Branch, tag or commit" onKeyDown={(e) => { if (e.key === 'Enter' && !busy && base.trim() && target.trim()) compare() }} /></Field>
        <Button disabled={busy} onClick={() => { setBase(target); setTarget(base) }}>Swap</Button>
        <Button variant="primary" disabled={busy || !base.trim() || !target.trim()} onClick={compare}>{busy ? 'Comparing' : 'Compare'}</Button>
      </div>
      <datalist id="comparison-refs">{[...new Set(['HEAD', ...refs])].map((ref) => <option key={ref} value={ref} />)}</datalist>
      <label className="row-inline text-sm"><input type="checkbox" checked={mergeBase} onChange={(e) => setMergeBase(e.target.checked)} />Changes since common ancestor</label>
      <p className="muted text-sm comparison-help">{mergeBase ? 'Review changes introduced by the target since it diverged from the base.' : 'Compare the exact file snapshots at the base and target.'}</p>
      {comparison && <div className="row-inline text-sm" role="status">
        <span className="sha">{comparison.baseSha.slice(0, 7)} → {comparison.targetSha.slice(0, 7)}</span>
        <span>{comparison.files.length} files · +{comparison.additions} −{comparison.deletions}{comparison.binaryFiles > 0 ? ` · ${comparison.binaryFiles} binary` : ''}</span>
      </div>}
      <div className="file-history-layout">
        <ul className="file-list file-history-list" role="listbox" aria-label="Compared files" tabIndex={0} aria-activedescendant={file ? `comparison-file-${selected}` : undefined} onKeyDown={onListKeyDown}>
          {comparison?.files.map((item, index) => <li key={item.path} id={`comparison-file-${index}`} role="option" aria-selected={selected === index} className={selected === index ? 'active' : ''} onClick={() => setSelected(index)} title={item.oldPath ? `${item.oldPath} → ${item.path}` : item.path}>
            <div className="row-inline"><FileStatusDot kind={item.status} oldPath={item.oldPath} /><span className="cell-ellipsis">{item.path}</span></div>
            {item.additions !== undefined && <span className="muted text-xs">+{item.additions} −{item.deletions}</span>}
          </li>)}
          {(!comparison || comparison.files.length === 0) && <li role="presentation" className="muted">{!comparison ? 'Choose references and compare.' : 'No file differences.'}</li>}
        </ul>
        <div className="diff-host">
          <div className="diff-toolbar"><span className="cell-ellipsis muted">{file?.path}</span><div className="diff-toolbar-end"><SyntaxHighlightToggle /><DiffViewSwitch /></div></div>
          <div className="diff-editor-slot">
            {diffError?.key === diffKey ? <Banner>{diffError.message}</Banner> : diff?.key === diffKey ? <FileDiffViewer diff={diff.result} editorKey={`compare:${diffKey}`} sideBySide={diffView === 'side-by-side'} syntaxHighlighting={syntaxHighlighting} /> : <div className="empty-state muted">{file ? 'Loading diff…' : ''}</div>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
