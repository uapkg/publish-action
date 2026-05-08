import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const shouldGenerateSourceMap = process.env.BUILD_SOURCE_MAP === 'true'

await rm('./dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: shouldGenerateSourceMap,
  legalComments: 'none',
  logLevel: 'info'
})
