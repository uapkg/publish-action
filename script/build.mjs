import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

await rm('./dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info'
})
