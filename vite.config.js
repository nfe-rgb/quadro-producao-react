// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  
  base: '/', // mantém como estava

  server: {
    host: true,   // permite acesso por IP na rede
    port: 5173,   // porta padrão
    strictPort: true, // garante que não mude de porta automaticamente
  },
})
