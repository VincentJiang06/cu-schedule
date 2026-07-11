import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ShareView } from './components/ShareView.tsx'
import { readShareId } from './lib/shareStore.ts'
import './styles.css'

// A `#v=<id>` hash opens the read-only share view instead of the full app.
const shareId = readShareId()

createRoot(document.getElementById('root')!).render(
  <StrictMode>{shareId ? <ShareView id={shareId} /> : <App />}</StrictMode>,
)
