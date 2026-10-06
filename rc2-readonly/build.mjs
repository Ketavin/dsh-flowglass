import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const output = resolve(root, 'dist')
await mkdir(output, { recursive: true })
const model = await readFile(resolve(root, 'model.mjs'), 'utf8')
const client = await readFile(resolve(root, 'client.mjs'), 'utf8')
const source = model.replace(/^export /gm, '') + '\n' + client.replace(/^import [^\r\n]*\r?\n/, '').replace(/^export /gm, '')
const bundle = `window.__ModuleLoader__.load({id:"dsh-flowglass",factory:require=>{\n${source}\nreturn makePlugin(require("react"));\n}});\n`
await writeFile(resolve(output, 'client.js'), bundle)
await writeFile(resolve(output, 'index.js'), 'export const name = "dsh-flowglass";\nexport function apply() {}\n')
await writeFile(resolve(output, 'cordis.patch.yml'), '- insert:\n    - id: flowglass-readonly\n      name: dsh-flowglass\n')
await writeFile(resolve(output, 'package.json'), JSON.stringify({
  name: 'dsh-flowglass', version: '0.7.4-arist.rc2.2', type: 'module', license: 'MIT',
  repository: { type: 'git', url: 'https://github.com/Iwctwbh/dsh-flowglass.git' },
  description: 'Read-only rc.2 execution window inside the existing Sidebar Tasks page',
  main: './index.js', exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
  files: ['index.js', 'client.js', 'cordis.patch.yml', 'BUILDINFO.json', 'README.md', 'LICENSE'],
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-connection', 'dsh-better-sidebar'] } },
  peerDependencies: { 'dsh-better-sidebar': '>=0.17.8 <0.18.0', react: '^18.2.0' },
  engines: { node: '>=22.19' },
}, null, 2) + '\n')
await writeFile(resolve(output, 'BUILDINFO.json'), JSON.stringify({
  upstream: '98ebd6fcf4ebc41d59bcac3ab33cdc80eb3f1377', mode: 'rc2-readonly', core: '0.1.1-rc.2',
  requiredSidebarCapability: 'taskViews', sourceSha256: createHash('sha256').update(model).update(client).digest('hex'),
  clientSha256: createHash('sha256').update(bundle).digest('hex'), hostRoutes: [], modelTools: [],
}, null, 2) + '\n')
await copyFile(resolve(root, '../LICENSE'), resolve(output, 'LICENSE'))
await copyFile(resolve(root, 'README.md'), resolve(output, 'README.md'))
console.log(`Built rc2-readonly client: ${Buffer.byteLength(bundle)} bytes`)
