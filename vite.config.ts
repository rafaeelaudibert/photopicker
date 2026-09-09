import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative, so the same bundle works on the dev server, at the project
  // Pages path (/photopicker/) and from a plain file:// copy of dist.
  base: './',
  server: { port: 5173 },
})
