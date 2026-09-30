import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerSW } from 'virtual:pwa-register'
import { isNativeApp, setupNativeShell } from './native'

// The web / PWA build keeps its offline service worker; the native app ships its own files.
if (!isNativeApp) registerSW({ immediate: true })
void setupNativeShell()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
