import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupNativeShell } from './services/native.js'
import { installLongScreenshotBridge } from './services/longScreenshot.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupNativeShell()
installLongScreenshotBridge()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
