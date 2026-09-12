import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// тема: системна за замовчуванням, з перемикачем
const saved = localStorage.getItem('ff.theme')
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (saved === 'dark' || (!saved && prefersDark)) document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
