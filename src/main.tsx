import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { envResult } from '@/lib/env'
import { ConfigErrorPage } from '@/pages/ConfigErrorPage'
import '@/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

createRoot(container).render(
  <StrictMode>{envResult.ok ? <App /> : <ConfigErrorPage problems={envResult.problems} />}</StrictMode>,
)
