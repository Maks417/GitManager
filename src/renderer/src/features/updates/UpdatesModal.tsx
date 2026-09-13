import type React from 'react'
import type { UpdateStatus } from '@shared/ipc'
import { Banner, Button, Modal } from '../../components/ui'

interface Props {
  status: UpdateStatus | null
  onClose: () => void
  onStatus: (s: UpdateStatus) => void
}

export function UpdatesModal({ status, onClose, onStatus }: Props): React.JSX.Element {
  return (
    <Modal
      title="Updates"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={() => void window.gitManager.updater.check().then(onStatus)}>Check now</Button>
          <Button
            variant="primary"
            disabled={!status?.downloaded}
            onClick={() => void window.gitManager.updater.install()}
          >
            Restart & install
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Checks public GitHub Releases on startup and from Help → Check for Updates.
      </p>
      <div className="stack">
        <div>Checking: {status?.checking ? 'yes' : 'no'}</div>
        <div>Available: {status?.available ? `yes (${status.version})` : 'no'}</div>
        <div>Downloaded: {status?.downloaded ? 'yes' : 'no'}</div>
        <div>Progress: {status?.progress != null ? `${status.progress.toFixed(0)}%` : '—'}</div>
        {status?.releaseNotes && <pre className="release-notes">{status.releaseNotes}</pre>}
        {status?.error && <Banner>{status.error}</Banner>}
      </div>
    </Modal>
  )
}
