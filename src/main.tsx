import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceSize } from './hooks/useDeviceSize'
import { initFirebaseSync } from './firebase/sync'
import { applyTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

applyDeviceSize()
applyTheme()
initFirebaseSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
