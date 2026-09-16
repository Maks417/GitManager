import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const CSP_PLACEHOLDER = '__CONTENT_SECURITY_POLICY__'

/** Vite HMR and React Refresh need inline scripts, eval and a websocket to the dev server. */
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ws://localhost:* http://localhost:*"

/** Packaged renderer: bundled scripts only, no eval, no network. Monaco injects <style> tags. */
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

function contentSecurityPolicy(): Plugin {
  let isDev = false
  return {
    name: 'git-manager-csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      // Fail the build rather than ship a page without a policy.
      if (!html.includes(CSP_PLACEHOLDER)) throw new Error('index.html is missing the CSP placeholder')
      return html.replace(CSP_PLACEHOLDER, isDev ? DEV_CSP : PROD_CSP)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@history-core': resolve('src/history-core'),
        '@merge-core': resolve('src/merge-core')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'git-utility': resolve('src/git-worker/utility-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@history-core': resolve('src/history-core'),
        '@merge-core': resolve('src/merge-core')
      }
    },
    plugins: [react(), contentSecurityPolicy()],
    build: {
      // electron-vite leaves the renderer unminified; the page keeps every loaded script's source in memory.
      minify: true
    },
    optimizeDeps: {
      // The parts of Monaco that src/renderer/src/lib/monaco-api.ts imports.
      include: [
        'monaco-editor/esm/vs/editor/edcore.main',
        'monaco-editor/esm/vs/editor/editor.api',
        'monaco-editor/esm/vs/basic-languages/monaco.contribution',
        'monaco-editor/esm/vs/language/json/monaco.contribution',
        '@monaco-editor/react'
      ]
    },
    worker: {
      format: 'es'
    }
  }
})
