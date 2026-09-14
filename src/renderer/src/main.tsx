import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { App } from './App'
import { setupMonaco } from './lib/monaco'
import { resolveAndApplyTheme } from './lib/theme'
import './styles/global.css'

resolveAndApplyTheme('system')
setupMonaco()

// Dropping a file onto the window would navigate to it; the main process blocks that too.
const isFileDrag = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types.includes('Files'))
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault()
})
window.addEventListener('drop', (e) => {
  if (isFileDrag(e)) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
