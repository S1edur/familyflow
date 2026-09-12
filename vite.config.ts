import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  // теку не чистимо: у примонтованій теці видалення може бути недоступне
  build: { emptyOutDir: false },
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
})
