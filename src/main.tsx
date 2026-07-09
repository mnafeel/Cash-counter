import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceSize } from './hooks/useDeviceSize'
import { loadData } from './storage/database'
import { applyTheme, normalizeTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

applyDeviceSize()
applyTheme(normalizeTheme(loadData().theme))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
