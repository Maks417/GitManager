import { useState } from 'react'
import type React from 'react'
import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal, Select } from '../../components/ui'

interface Props {
  accounts: ProviderAccount[]
  onClose: () => void
  onChanged: () => Promise<void>
  onCloneRemote: (repo: RemoteRepo) => void
}

export function AccountsModal({ accounts, onClose, onChanged, onCloneRemote }: Props): React.JSX.Element {
  const [provider, setProvider] = useState<'github' | 'gitlab' | 'bitbucket'>('github')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repos, setRepos] = useState<RemoteRepo[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(accounts[0]?.id ?? null)

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const account = await window.gitManager.providers.saveToken(
        provider,
        token.trim(),
        username.trim() || undefined
      )
      setToken('')
      setActiveAccount(account.id)
      await onChanged()
      const list = await window.gitManager.providers.listRepos(account.id)
      setRepos(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const loadRepos = async (id: string): Promise<void> => {
    setActiveAccount(id)
    setBusy(true)
    setError(null)
    try {
      setRepos(await window.gitManager.providers.listRepos(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Host accounts"
      onClose={onClose}
      wide
      footer={
        <div className="modal-actions">
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Connect GitHub, GitLab, or Bitbucket with a personal access / app password. HTTPS uses Git Credential Manager on
        clone/fetch/push; SSH remotes use your OpenSSH agent and keys.
      </p>
      {error && <Banner>{error}</Banner>}

      <div className="stack">
        <Field label="Provider">
          <Select
            className="w-full"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="bitbucket">Bitbucket</option>
          </Select>
        </Field>
        {provider === 'bitbucket' && (
          <Field label="Username">
            <Input className="w-full" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
        )}
        <Field label="Token / app password">
          <Input
            className="w-full"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste token — stored in OS secure storage"
          />
        </Field>
        <Button variant="primary" disabled={busy || !token.trim()} onClick={() => void connect()}>
          Connect
        </Button>
      </div>

      <div className="panel-title">Connected</div>
      <ul className="repo-list">
        {accounts.map((a) => (
          <li key={a.id} className={a.id === activeAccount ? 'active' : ''} onClick={() => void loadRepos(a.id)}>
            <strong>{a.provider}</strong> {a.displayName} (@{a.username})
            <div>
              <Button
                className="mt-1"
                onClick={(e) => {
                  e.stopPropagation()
                  void window.gitManager.providers.disconnect(a.id).then(onChanged)
                }}
              >
                Disconnect
              </Button>
            </div>
          </li>
        ))}
        {accounts.length === 0 && <li className="muted">No accounts yet</li>}
      </ul>

      <div className="panel-title">Remote repositories</div>
      <ul className="repo-list" style={{ maxHeight: 240 }}>
        {repos.map((r) => (
          <li key={r.id}>
            <div className="cell-ellipsis">{r.fullName}</div>
            <div className="muted cell-ellipsis">{r.description}</div>
            <Button className="mt-1" onClick={() => onCloneRemote(r)}>
              Clone HTTPS
            </Button>
          </li>
        ))}
        {activeAccount && repos.length === 0 && !busy && <li className="muted">No repositories loaded</li>}
      </ul>
    </Modal>
  )
}
