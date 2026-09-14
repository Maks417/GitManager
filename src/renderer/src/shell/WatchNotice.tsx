import { useState } from 'react'
import type React from 'react'
import { X } from 'lucide-react'
import { Banner, IconButton } from '../components/ui'
import { useSession } from '../state/RepoSessionProvider'

/** Says why changes are polled instead of watched (e.g. Linux's inotify limit). Dismissed per message. */
export function WatchNotice(): React.JSX.Element | null {
  const { watchNotice } = useSession()
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!watchNotice || watchNotice === dismissed) return null
  return (
    <Banner tone="info" className="watch-notice">
      <span className="watch-notice-text">{watchNotice}</span>
      <IconButton label="Dismiss" hint="Dismiss" onClick={() => setDismissed(watchNotice)}>
        <X size={14} strokeWidth={2} />
      </IconButton>
    </Banner>
  )
}
