/**
 * 将 Client 入口打包成单个浏览器产物。
 *
 * DSH 以惰性工厂的形式加载 Client 插件，并将其注册到外壳的
 * `window.__ModuleLoader__` 上，因此本包发布的是一个普通 ES 模块，而非
 * 一个模块图。esbuild 让这一约定保持简单：无外部依赖、无运行时
 * 导入、仅一个文件。
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
    js: '// @neoxuxo/dsh-no-workspace — generated from src/client by scripts/build-client.mjs; do not edit.',
  },
})
console.log('Built dist/client/index.js')
