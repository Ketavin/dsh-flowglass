import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readdirSync } from 'node:fs'

if (!process.env.P5_CORE_ROOT) throw new Error('Set P5_CORE_ROOT to the isolated rc.2 Core checkout')
const root = resolve(process.env.P5_CORE_ROOT)
const require = createRequire(resolve(root, 'package.json'))
const loader = pathToFileURL(require.resolve('tsx')).href
const tests = resolve(dirname(fileURLToPath(import.meta.url)), 'test')
const result = spawnSync(process.execPath, ['--import', loader, '--test', ...readdirSync(tests).filter(file => file.endsWith('.test.mjs')).map(file => resolve(tests, file))], {
  stdio: 'inherit', env: { ...process.env, TSX_TSCONFIG_PATH: resolve(root, 'tsconfig.base.json') },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
