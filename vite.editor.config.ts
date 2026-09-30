import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { levelEditorApi } from './tools/level-editor/levelApi'

// Local level editor: `npm run editor`, then open http://localhost:5180/editor.html.
// Serves the editor page plus the level API (tools/level-editor/levelApi.ts), which reads and
// writes the project's own level files. A development tool only — never part of the app build.
export default defineConfig({
  plugins: [react(), levelEditorApi()],
  server: { port: 5180, strictPort: true, open: '/editor.html' },
  // Only the editor page: the game's own entry (index.html) needs the PWA plugin.
  optimizeDeps: { entries: ['editor.html'] },
})
