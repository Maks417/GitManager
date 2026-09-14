import { useState } from 'react'
import type React from 'react'
import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import type { ProviderId } from '@shared/providers'
import { Banner, Button, Field, Input, Modal, Select } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'

interface Props {
  accounts: ProviderAccount[]
  onClose: () => void
  onChanged: () => Promise<void>
  /** Clone URL (HTTPS or SSH) to prefill in the clone dialog. */
  onCloneRemote: (url: string) => void
}

const TOKEN_LABEL: Record<ProviderId, string> = {
  github: 'Personal access token',
  gitlab: 'Personal access token',
  bitbucket: 'API token'
}

export function AccountsModal({ accounts, onClose, onChanged, onCloneRemote }: Props): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('github')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [gitlabUrl, setGitlabUrl] = useState('')
  const [repos, setRepos] = useState<RemoteRepo[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(accounts[0]?.id ?? null)
  const { busy, error, run } = useAsyncAction()

  const connect = (): void => {
    void run(async () => {
      const account = await window.gitManager.providers.saveToken(
        provider,
        token.trim(),
        username.trim() || undefined,
        provider === 'gitlab' ? gitlabUrl.trim() || undefined : undefined
      )
      setToken('')
      setActiveAccount(account.id)
      await onChanged()
      const list = await window.gitManager.providers.listRepos(account.id)
      setRepos(list)
    })
  }

  const loadRepos = (id: string): void => {
    setActiveAccount(id)
    void run(async () => {
      setRepos(await window.gitManager.providers.listRepos(id))
    })
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
        Connect GitHub or GitLab — GitLab.com or your own GitLab instance — with a personal access token, or
        Bitbucket with an Atlassian API token and your account email. Clone, fetch and push still use your Git
        credentials: HTTPS through your credential helper, SSH through your agent and keys.
      </p>
      {error && <Banner>{error}</Banner>}

      <div className="stack">
        <Field label="Provider">
          <Select
            className="w-full"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="bitbucket">Bitbucket</option>
          </Select>
        </Field>
        {provider === 'gitlab' && (
          <Field label="GitLab address (leave empty for GitLab.com)">
            <Input
              className="w-full"
              value={gitlabUrl}
              onChange={(e) => setGitlabUrl(e.target.value)}
              placeholder="https://gitlab.example.com"
            />
          </Field>
        )}
        {provider === 'bitbucket' && (
          <Field label="Atlassian account email">
            <Input
              className="w-full"
              type="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
        )}
        <Field label={TOKEN_LABEL[provider]}>
          <Input
            className="w-full"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste token — encrypted by the OS when available"
          />
        </Field>
        <Button
          variant="primary"
          disabled={busy || !token.trim() || (provider === 'bitbucket' && !username.trim())}
          onClick={connect}
        >
          Connect
        </Button>
      </div>

      <div className="panel-title">Connected</div>
      <ul className="repo-list">
        {accounts.map((a) => (
          <li key={a.id} className={a.id === activeAccount ? 'active' : ''} onClick={() => loadRepos(a.id)}>
            <strong>{a.provider}</strong> {a.displayName} (@{a.username})
            {a.baseUrl && <span className="muted"> · {a.host}</span>}
            {a.secureStorage === false && (
              <span className="muted text-xs"> · token stored without OS encryption</span>
            )}
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
            <div className="row-inline mt-1">
              <Button onClick={() => onCloneRemote(r.cloneUrlHttps)}>Clone HTTPS</Button>
              {r.cloneUrlSsh && <Button onClick={() => onCloneRemote(r.cloneUrlSsh)}>Clone SSH</Button>}
            </div>
          </li>
        ))}
        {activeAccount && repos.length === 0 && !busy && <li className="muted">No repositories loaded</li>}
      </ul>
    </Modal>
  )
}
