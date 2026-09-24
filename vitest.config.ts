import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        // next-auth's ESM imports `next/server` without an extension, which
        // Node's own loader can't resolve (next has no exports map), so
        // let Vite resolve it.
        inline: ['next-auth'],
      },
    },
  },
})
