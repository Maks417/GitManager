import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['tests/setup/git-env.ts']
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@history-core': resolve('src/history-core'),
      '@merge-core': resolve('src/merge-core'),
      '@renderer': resolve('src/renderer')
    }
  }
})
