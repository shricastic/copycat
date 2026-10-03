import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

/** Production builds emit a .css file, so inline styles are not needed: tighten the CSP. */
function cspForProduction(): Plugin {
  return {
    name: 'copycat-csp-production',
    apply: 'build',
    transformIndexHtml(html) {
      const out = html.replace("style-src 'self' 'unsafe-inline'", "style-src 'self'")
      if (out === html) throw new Error('CSP style-src not found in index.html')
      return out
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...shared
      }
    },
    plugins: [react(), cspForProduction()],
    build: { minify: true }
  }
})
