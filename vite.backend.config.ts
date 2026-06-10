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
        'crypto',
        'stream',
        'buffer',
        'net',
        'tls',
        'events',
        'util',
        'os',
      ],
    },
  },
  platform: 'node',
})
