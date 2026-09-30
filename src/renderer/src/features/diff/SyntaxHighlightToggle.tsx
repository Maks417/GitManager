import type React from 'react'
import { Palette } from 'lucide-react'
import { IconButton } from '../../components/ui'
import { useLayout } from '../../state/LayoutProvider'

/** Syntax colors on or off for every file diff and the merge editor, saved as `AppPreferences.syntaxHighlighting`. */
export function SyntaxHighlightToggle(): React.JSX.Element {
  const { syntaxHighlighting, setSyntaxHighlighting } = useLayout()
  return (
    <IconButton
      label="Syntax colors"
      hint={syntaxHighlighting ? 'Syntax colors are on' : 'Syntax colors are off'}
      className="toggle-btn"
      aria-pressed={syntaxHighlighting}
      onClick={() => setSyntaxHighlighting(!syntaxHighlighting)}
    >
      <Palette size={14} strokeWidth={1.75} />
    </IconButton>
  )
}
