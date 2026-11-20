/**
 * Bundle the Client entry into one browser artifact.
 *
 * DSH loads a Client plugin as a lazy factory registered on the shell's
 * `window.__ModuleLoader__`, so the package ships one plain ES module rather than
 * a module graph. esbuild keeps that contract trivial: no externals, no runtime
 * imports, one file.
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outdir = path.join(root, 'dist', 'client')

await mkdir(outdir, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.ts'],
  outfile: path.join(outdir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: '// @local/dsh-no-workspace — generated from src/client by scripts/build-client.mjs; do not edit.',
  },
})
console.log('Built dist/client/index.js')
