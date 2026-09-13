import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@history-core': resolve('src/history-core'),
        '@merge-core': resolve('src/merge-core')
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
    plugins: [react()],
    optimizeDeps: {
      include: ['monaco-editor', '@monaco-editor/react']
    },
    worker: {
      format: 'es'
    }
  }
})
