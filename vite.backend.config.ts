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
        '@anthropic-ai/claude-agent-sdk',
        '@xenova/transformers',
        // Match `googleapis` and its per-API subpaths (e.g.
        // `googleapis/build/src/apis/gmail`) so they stay external rather than
        // getting bundled. googleClient.ts loads only the gmail/calendar
        // subpaths to avoid the slow meta-package.
        /^googleapis(\/|$)/,
        'google-auth-library',
        '@ffmpeg-installer/ffmpeg',
      ],
    },
  },
  platform: 'node',
})
