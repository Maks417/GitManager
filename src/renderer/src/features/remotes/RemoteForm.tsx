import { useState } from 'react'
import type React from 'react'
import type { RemoteConfig, SaveRemoteRequest } from '@shared/ipc'
import { Button, Field, Input } from '../../components/ui'

interface Props {
  repoPath: string
  remotes: RemoteConfig[]
  remote?: RemoteConfig
  disabled: boolean
  onSave: (request: SaveRemoteRequest) => void
  onCancel: () => void
}

/** Shared by remote management and the first-publication flow. It never fetches or pushes. */
export function RemoteForm({ repoPath, remotes, remote, disabled, onSave, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState(remote?.name ?? (remotes.some((item) => item.name === 'origin') ? '' : 'origin'))
  const [url, setUrl] = useState(remote?.fetchUrl ?? '')
  const [pushUrl, setPushUrl] = useState(remote && remote.pushUrl !== remote.fetchUrl ? remote.pushUrl : '')
  const valid = Boolean(name.trim() && url.trim())

  return (
    <form className="remote-form" onSubmit={(e) => {
      e.preventDefault()
      if (disabled || !valid) return
      onSave({ repoPath, name: name.trim(), url: url.trim(), pushUrl: pushUrl.trim(), create: !remote })
    }}>
      <Field label="Name">
        <Input value={name} readOnly={Boolean(remote)} disabled={disabled} onChange={(e) => setName(e.target.value)} placeholder="origin" autoFocus={!remote} />
      </Field>
      <Field label="Repository URL">
        <Input value={url} disabled={disabled} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repository.git" autoFocus={Boolean(remote)} />
      </Field>
      <p className="muted text-sm modal-lead">An existing repository’s HTTPS or SSH URL, or a local repository path.</p>
      <details className="remote-advanced" open={remote && remote.pushUrl !== remote.fetchUrl ? true : undefined}>
        <summary>Advanced</summary>
        <Field label="Separate push URL (optional)">
          <Input value={pushUrl} disabled={disabled} onChange={(e) => setPushUrl(e.target.value)} placeholder="Use the repository URL" />
        </Field>
      </details>
      <div className="modal-actions">
        <Button disabled={disabled} onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={disabled || !valid}>{remote ? 'Save' : 'Add remote'}</Button>
      </div>
    </form>
  )
}
