import '../index.css'
import './editor.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorApp } from './EditorApp'

createRoot(document.getElementById('editor-root')!).render(
  <StrictMode>
    <EditorApp />
  </StrictMode>,
)
