import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getStoredRuntimeVersion, loadSpineRuntime } from './spineRuntime'

const rootElement = document.getElementById('root')!
const root = createRoot(rootElement)
const activeRuntimeVersion = getStoredRuntimeVersion()

loadSpineRuntime(activeRuntimeVersion).then((spineRuntime) => {
  root.render(
    <StrictMode>
      <App
        spineRuntime={spineRuntime}
        activeRuntimeVersion={activeRuntimeVersion}
      />
    </StrictMode>,
  )
})
