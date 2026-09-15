import type React from 'react'
import { Columns2, TextAlignJustify } from 'lucide-react'
import { SegmentedControl } from '../../components/ui'
import { useLayout } from '../../state/LayoutProvider'

/** Inline or side-by-side layout for every file diff, saved as `AppPreferences.diffView`. */
export function DiffViewSwitch(): React.JSX.Element {
  const { diffView, setDiffView } = useLayout()
  return (
    <SegmentedControl
      ariaLabel="Diff view"
      value={diffView}
      onChange={setDiffView}
      options={[
        {
          value: 'inline',
          label: 'Inline',
          hint: 'Show the changes in one file',
          icon: <TextAlignJustify size={14} strokeWidth={1.75} />
        },
        {
          value: 'side-by-side',
          label: 'Side by side',
          hint: 'Old and new file side by side',
          icon: <Columns2 size={14} strokeWidth={1.75} />
        }
      ]}
    />
  )
}
