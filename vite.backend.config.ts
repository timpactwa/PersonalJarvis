import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve('src/backend/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: 'dist-electron/backend',
    target: 'node18',
    ssr: true,
    rollupOptions: {
      external: [
        'ws',
        'express',
        'http',
        'path',
        'fs',
        'fs/promises',
        'crypto',
        'stream',
        'buffer',
        'net',
        'tls',
        'events',
        'util',
        'os',
        'url',
        'child_process',
        'better-sqlite3',
        'dotenv',
        '@anthropic-ai/sdk',
        '@xenova/transformers',
        'googleapis',
        'google-auth-library',
      ],
    },
  },
  platform: 'node',
})
