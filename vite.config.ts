import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function apiServerPlugin() {
  let api: ChildProcess | null = null
  return {
    name: 'ng-migrator-api',
    configureServer(server: any) {
      api = spawn('node', [join(__dirname, 'ng-migrator-ui.mjs')], {
        stdio: 'inherit',
        env: { ...process.env, NO_OPEN: '1' },
      })
      api.on('error', (err) => console.error('[api]', err.message))
      server.httpServer?.on('close', () => api?.kill('SIGTERM'))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiServerPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(path.join(__dirname, './src')),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4242',
    },
  },
})
