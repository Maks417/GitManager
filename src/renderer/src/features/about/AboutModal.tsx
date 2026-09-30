import { useEffect, useState } from 'react'
import type React from 'react'
import type { AppInfo, UpdateStatus } from '@shared/ipc'
import { Banner, Button, IconButton, Modal } from '../../components/ui'
import { toErrorMessage } from '../../lib/errors'
import logoUrl from '../../../favicon.svg'
import { GitHubIcon, LinkedInIcon } from './BrandIcons'

const AUTHOR = {
  name: 'Max Davydov',
  github: 'https://github.com/Maks417',
  linkedin: 'https://www.linkedin.com/in/max-davydov/'
}

interface Props {
  status: UpdateStatus | null
  onClose: () => void
  onStatus: (s: UpdateStatus) => void
}

function openExternal(url: string): void {
  void window.gitManager.shell.openExternal(url)
}

export function AboutModal({ status, onClose, onStatus }: Props): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await window.gitManager.app.getInfo()
        if (!cancelled) setInfo(next)
      } catch (err) {
        if (!cancelled) setLoadError(toErrorMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const name = info?.name ?? 'Git Manager'
  const versionText = info ? `Version ${info.version} (${info.architecture})` : 'Loading version…'
  const releasesUrl = info ? `${info.homepage}/releases` : null
  // HEAD resolves to the default branch on GitHub, whatever it is called.
  const licenseUrl = info ? `${info.homepage}/blob/HEAD/LICENSE` : null

  const updateMessage = ((): string | null => {
    if (!status) return null
    if (status.error) return null
    if (status.checking) return 'Checking for updates…'
    if (status.downloaded) return `Update ${status.version ?? ''} is ready to install.`
    if (status.available) {
      if (status.progress != null) return `Downloading update… ${status.progress.toFixed(0)}%`
      return `Update ${status.version ?? ''} is available.`
    }
    return 'You have the latest version.'
  })()

  return (
    <Modal
      title={`About ${name}`}
      hideTitle
      onClose={onClose}
      className="about-modal"
      footer={
        <div className="modal-actions">
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="about-content">
        <img className="about-logo" src={logoUrl} alt="" width={64} height={64} />
        <h3 className="about-title">About {name}</h3>
        <p className="about-version muted">
          {versionText}
          {releasesUrl && (
            <>
              {' '}
              (
              <button type="button" className="link-btn" onClick={() => openExternal(releasesUrl)}>
                release notes
              </button>
              )
            </>
          )}
        </p>

        <div className="about-author">
          <span className="about-author-name">Created by {AUTHOR.name}</span>
          <div className="about-social">
            <IconButton label={`${AUTHOR.name} on GitHub`} onClick={() => openExternal(AUTHOR.github)}>
              <GitHubIcon />
            </IconButton>
            <IconButton label={`${AUTHOR.name} on LinkedIn`} onClick={() => openExternal(AUTHOR.linkedin)}>
              <LinkedInIcon />
            </IconButton>
          </div>
        </div>

        <div className="about-update">
          {updateMessage && <p className="about-update-status muted">{updateMessage}</p>}
          {status?.error && <Banner>{status.error}</Banner>}
          {status?.downloaded ? (
            <Button variant="primary" onClick={() => void window.gitManager.updater.install()}>
              Restart & install
            </Button>
          ) : (
            <Button
              disabled={Boolean(status?.checking || (status?.available && !status.error))}
              onClick={() => void window.gitManager.updater.check().then(onStatus)}
            >
              Check for Updates
            </Button>
          )}
        </div>

        {loadError && <Banner>{loadError}</Banner>}

        <div className="about-links">
          {info && (
            <button type="button" className="link-btn" onClick={() => openExternal(info.homepage)}>
              View on GitHub
            </button>
          )}
          {licenseUrl && (
            <button type="button" className="link-btn" onClick={() => openExternal(licenseUrl)}>
              License and Open Source Notices
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
