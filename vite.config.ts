import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * GitHub Pages project sites live under /<repo>/; user/org sites use /.
 * CI sets BASE_PATH; local dev keeps '/'.
 */
function pagesBase(): string {
  const fromEnv = process.env.BASE_PATH
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`

  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
    const repo = process.env.GITHUB_REPOSITORY.split('/')[1] ?? ''
    if (repo.endsWith('.github.io')) return '/'
    return `/${repo}/`
  }

  return '/'
}

export default defineConfig({
  plugins: [react()],
  base: pagesBase(),
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
