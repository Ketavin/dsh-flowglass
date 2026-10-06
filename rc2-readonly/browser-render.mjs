import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = dirname(fileURLToPath(import.meta.url))
const sidebar = resolve(process.env.P5_SIDEBAR_ROOT ?? resolve(root, '../../sidebar'))
const core = resolve(process.env.P5_CORE_ROOT ?? '')
if (!process.env.P5_CORE_ROOT) throw new Error('Set P5_CORE_ROOT to an isolated Core with Playwright installed')
const requireSidebar = createRequire(resolve(sidebar, 'package.json'))
const react = dirname(requireSidebar.resolve('react/package.json'))
const reactDom = dirname(requireSidebar.resolve('react-dom/package.json'))
const { chromium } = await import(pathToFileURL(resolve(core, 'apps/web/node_modules/playwright/index.mjs')).href)
const out = resolve(root, `browser-evidence-${Date.now()}`)
await mkdir(out)
const html = `<!doctype html><html><head><meta charset="utf-8"><title>P5 controlled renderer fixture</title><style>body{margin:0;background:#fff;color:#222;font:14px system-ui}body.dark{background:#1c1c1c;color:#eee}#root{height:100vh;max-width:650px;margin:auto}</style></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load:entry=>{window.plugin=entry.factory(id=>{if(id!=='react')throw Error(id);return React})}}</script><script src="/plugin.js"></script><script>
const observable=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},publish:next=>{value=next;for(const fn of [...listeners])fn()},size:()=>listeners.size}};
const events=[{kind:'assistant',seq:1,time:1,turn:1,step:0,blocks:[{kind:'text',text:'计划并执行一次受控只读检查。'}]},{kind:'tool-result',seq:3,time:3,callId:'call-read-1',call:{name:'read_file — 一个很长的工具名称用于窄窗口验证'.repeat(3),argsRaw:'{"path":"fixture.txt"}'},isError:true,content:[{type:'text',text:'<img src=x onerror="window.injected=true"> controlled missing file'}]}];
const snapshot=()=>({sessionId:'a',openState:'open',running:false,nodes:events,partial:null,runningCalls:[],hasMore:true,chat:{timeline:{turnOrder:[1],turns:new Map([[1,{end:{seq:4,time:4,data:{reason:{kind:'aborted'}}}}]])}}});
const listValue=()=>({phase:'ready',byId:{},subagentsByParent:{a:{state:'ready',entries:[{kind:'child',id:'child-1',mode:'continuable',label:'受控子代理',activity:'inactive',hasChildren:true}]}},jobsBySession:{a:[{id:'bash-1',kind:'bash',label:'已取消的后台任务',status:'killed'}]}});
const face=observable(snapshot()), list=observable(listValue()),hostDescription=observable({id:'A'}),opened=[];let descriptor;const disposers=[];
const ctx={sessions:{list,binding:()=>({session:face}),openSubagent:address=>opened.push(address)},connection:{hostDescription},betterSidebar:{registerTaskView:d=>{descriptor=d;return()=>{descriptor=null}}},effect:fn=>disposers.push(fn())};plugin.apply(ctx);
const root=ReactDOM.createRoot(document.getElementById('root'));
const render=visible=>root.render(React.createElement(descriptor.component,{ctx,scope:{sessionId:'a'},visible}));render(true);
window.fixture={disconnect:()=>hostDescription.publish(undefined),reconnect:()=>hostDescription.publish({id:'B'}),baseline:()=>{face.publish({...snapshot(),openState:'loading'});face.publish(snapshot());list.publish(listValue())},hide:()=>render(false),show:()=>render(true),unmount:()=>{root.unmount();disposers.forEach(fn=>fn())},subscriptions:()=>face.size()+list.size()+hostDescription.size(),opened};
</script></body></html>`
const routes = new Map([
  ['/', { body: html, type: 'text/html' }],
  ['/react.js', { body: await readFile(resolve(react, 'umd/react.development.js')), type: 'text/javascript' }],
  ['/react-dom.js', { body: await readFile(resolve(reactDom, 'umd/react-dom.development.js')), type: 'text/javascript' }],
  ['/plugin.js', { body: await readFile(resolve(root, 'dist/client.js')), type: 'text/javascript' }],
])
const server = createServer((req, res) => { const route = routes.get(req.url); if (!route) { res.writeHead(404);res.end();return } res.writeHead(200, { 'content-type': route.type });res.end(route.body) })
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
let browser
const checks = []
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.locator('[data-flowglass-readonly]').waitFor()
  assert.match(await page.getByRole('status').innerText(), /已取消/)
  assert.equal(await page.locator('details[open]').count(), 0)
  checks.push('native-module-bundle-rendered-with-collapsed-details')
  await page.locator('details').last().locator('summary').click()
  assert.equal(await page.locator('.flowglass-rc2 img').count(), 0)
  assert.equal(await page.evaluate(() => window.injected), undefined)
  checks.push('log-markup-is-text')
  await page.getByRole('button', { name: '受控子代理' }).click()
  assert.deepEqual(await page.evaluate(() => window.fixture.opened), [{ parentSessionId: 'a', childSessionId: 'child-1', mode: 'continuable' }])
  checks.push('catalog-address-navigation-only')
  await page.screenshot({ path: resolve(out, 'light-900.png'), fullPage: true })
  await page.setViewportSize({ width: 360, height: 800 })
  await page.evaluate(() => document.body.classList.add('dark'))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: resolve(out, 'dark-360.png'), fullPage: true })
  checks.push('dark-narrow-long-title-no-overflow')
  await page.getByRole('combobox', { name: '执行过程筛选' }).selectOption('failures')
  assert.equal(await page.getByRole('list', { name: '执行时间线' }).locator('li').count(), 1)
  checks.push('failure-filter')
  await page.evaluate(() => window.fixture.disconnect())
  await page.getByRole('status').filter({ hasText: '状态未知' }).waitFor()
  await page.evaluate(() => window.fixture.reconnect())
  assert.match(await page.getByRole('status').innerText(), /状态未知/)
  await page.evaluate(() => window.fixture.baseline())
  await page.getByRole('status').filter({ hasText: '已取消' }).waitFor()
  checks.push('disconnect-replacement-baseline')
  await page.evaluate(() => window.fixture.hide())
  await page.waitForFunction(() => window.fixture.subscriptions() === 0)
  await page.evaluate(() => window.fixture.show())
  await page.waitForFunction(() => window.fixture.subscriptions() === 3)
  await page.evaluate(() => window.fixture.unmount())
  await page.waitForFunction(() => window.fixture.subscriptions() === 0)
  assert.deepEqual(errors, [])
  checks.push('hidden-and-unmount-cleanup')
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ scope: 'controlled-renderer-fixture-not-assembled-host', status: 'PASS', checks, errors }, null, 2))
  console.log(JSON.stringify({ output: out, checks: checks.length, status: 'PASS' }))
} catch (error) {
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error) }, null, 2));throw error
} finally {
  await browser?.close()
  await new Promise(resolveClose => server.close(resolveClose))
}
