import { useEffect, useState } from 'react'
import type React from 'react'
import type { Repository } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal, Select } from '../../components/ui'
import { CLONE_URL_SESSION_KEY } from '../../lib/copy'
import { useAsyncAction } from '../../lib/useAsyncAction'

interface Props {
  onClose: () => void
  onCloned: (repo: Repository) => Promise<void>
}

export function CloneModal({ onClose, onCloned }: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [transport, setTransport] = useState<'https' | 'ssh'>('https')
  const { busy, error, setError, run } = useAsyncAction()

  useEffect(() => {
    const preset = sessionStorage.getItem(CLONE_URL_SESSION_KEY)
    if (preset) {
      setUrl(preset)
      sessionStorage.removeItem(CLONE_URL_SESSION_KEY)
    }
  }, [])

  const pickDir = async (): Promise<void> => {
    const next = await window.gitManager.repo.pickDirectory()
    if (next) setTargetDir(next)
  }

  const clone = (): void => {
    void run(async () => {
      if (!url.trim() || !targetDir.trim()) throw new Error('URL and target folder are required')
      const repo = await window.gitManager.repo.clone({
        url: url.trim(),
        targetDir: targetDir.trim(),
        transport
      })
      await onCloned(repo)
    })
  }

  return (
    <Modal
      title="Clone repository"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={clone}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Paste an HTTPS or SSH URL from GitHub, GitLab, Bitbucket, or any Git host.
      </p>
      {error && <Banner>{error}</Banner>}
      <Field label="Repository URL">
        <Input className="w-full" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Parent folder">
        <div className="row-inline">
          <Input className="w-full" value={targetDir} onChange={(e) => setTargetDir(e.target.value)} />
          <Button onClick={() => void pickDir()}>Browse…</Button>
        </div>
      </Field>
      <Field label="Preferred transport">
        <Select
          className="w-full"
          value={transport}
          onChange={(e) => setTransport(e.target.value as 'https' | 'ssh')}
        >
          <option value="https">HTTPS (GCM)</option>
          <option value="ssh">SSH (OpenSSH agent)</option>
        </Select>
      </Field>
    </Modal>
  )
}
