import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { captureTimeline, createTimelineStore, MAX_NODES, MAX_BODY } from '../model.mjs'

const listOf = (extra = {}) => ({ phase: 'ready', byId: {}, subagentsByParent: {}, jobsBySession: {}, ...extra })
const snapshotOf = (extra = {}) => ({ sessionId: 'a', openState: 'open', running: false, nodes: [], runningCalls: [], partial: null, hasMore: false,
  chat: { timeline: { turnOrder: [], turns: new Map() } }, ...extra })
const capture = (snapshot, list = listOf(), options = {}) => captureTimeline({ sessionId: 'a', snapshot, list, connected: true, ...options })
function observable(value) {
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    publish(next) { value = next; for (const listener of [...listeners]) listener() }, get size() { return listeners.size } }
}

test('inactive, unknown and true terminal outcomes remain distinct', () => {
  assert.equal(capture(snapshotOf()).state, 'inactive')
  assert.equal(capture(undefined).state, 'unloaded')
  for (const [reason, state] of Object.entries({ completed: 'completed', aborted: 'cancelled', error: 'failed', interrupted: 'interrupted', blocked: 'blocked', 'max-tokens': 'max-tokens', future: 'unknown' })) {
    const s = snapshotOf({ chat: { timeline: { turnOrder: [1], turns: new Map([[1, { end: { seq: 9, time: 9, data: { reason: { kind: reason } } } }]]) } } })
    assert.equal(capture(s).state, state)
    assert.equal(capture(s, listOf(), { connected: false }).state, 'unknown')
    assert.equal(capture(s, listOf(), { baselineReady: false }).state, 'unknown')
  }
  const unknown = snapshotOf({ chat: { timeline: { turnOrder: [1], turns: new Map([[1, { end: { seq: 9, time: 9, data: { reason: { kind: '__proto__' } } } }]]) } } })
  assert.equal(capture(unknown).state, 'unknown')
})

test('tool call IDs deduplicate parent/child and running/result overlap without deriving subagents from text', () => {
  const child = { kind: 'tool-result', callId: 'child', call: { name: 'read', argsRaw: '{}' }, seq: 3, time: 3, content: [{ type: 'text', text: 'UUID 713472bd-29fa-4772-99cd-b4f171e19566' }], isError: true }
  const parent = { kind: 'tool-result', callId: 'parent', call: { name: 'code' }, seq: 4, time: 4, content: [], isError: false, subCalls: [child] }
  const s = snapshotOf({ nodes: [parent, child], running: true, runningCalls: [{ callId: 'parent', name: 'code', time: 2 }, { callId: 'parallel', name: 'search', time: 2 }] })
  const model = capture(s)
  assert.equal(model.rows.filter(row => row.callId === 'child').length, 1)
  assert.equal(model.rows.find(row => row.callId === 'child').state, 'failed')
  assert.equal(model.rows.find(row => row.callId === 'parallel').state, 'running')
  assert.equal(model.rows.find(row => row.callId === 'parent').state, 'completed')
  assert.deepEqual(model.related, [])
})

test('partial is replaced by matching settled message and payload/window copies are bounded', () => {
  const partial = { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'stream' }] }
  assert.equal(capture(snapshotOf({ partial, running: true })).rows[0].state, 'streaming')
  const nodes = Array.from({ length: MAX_NODES + 10 }, (_, seq) => ({ kind: 'assistant', seq, time: seq, turn: 1, step: seq, blocks: [{ kind: 'text', text: '<script>alert(1)</script>' + 'a'.repeat(MAX_BODY) }] }))
  const s = snapshotOf({ nodes, partial: { ...partial, step: nodes.at(-1).step }, hasMore: true })
  const model = capture(s)
  assert.equal(model.rows.length, MAX_NODES)
  assert.equal(model.omitted, 10)
  assert.equal(model.rows.some(row => row.kind === 'partial'), false)
  assert.equal(model.rows[0].body.length, MAX_BODY)
  assert.ok(model.rows[0].body.startsWith('<script>'))
  nodes[10].blocks[0].text = 'mutated'
  assert.notEqual(model.rows[0].body, 'mutated')
  assert.equal(model.hasMore, true)
})

test('catalog authority and Job statuses come only from the native mirrors', () => {
  const list = listOf({ subagentsByParent: { a: { state: 'ready', entries: [
    { kind: 'child', id: 'child', mode: 'continuable', label: 'Child', activity: 'inactive', hasChildren: true },
    { kind: 'diagnostic', id: 'bad', reason: 'corrupt' },
  ] } }, jobsBySession: { a: ['running', 'stopping', 'completed', 'killed', 'failed'].map(status => ({ id: status, kind: 'bash', label: status, status })) } })
  const model = capture(snapshotOf(), list)
  assert.deepEqual(model.related[0].address, { parentSessionId: 'a', childSessionId: 'child', mode: 'continuable' })
  assert.equal(model.related[0].state, 'inactive')
  assert.equal(model.related[1].address, undefined)
  assert.deepEqual(model.jobs.map(job => job.state), ['running', 'stopping', 'completed', 'killed', 'failed'])
  assert.ok(capture(snapshotOf(), list, { connected: false }).jobs.every(job => job.state === 'unknown'))
})

test('store waits for an actual native window reload, not any list change, after Host replacement', () => {
  const list = observable(listOf())
  const face = observable(snapshotOf({ running: true }))
  const hostDescription = observable({ id: 'host-a' })
  const sessions = { list, binding: () => ({ session: face }) }
  const store = createTimelineStore({ sessions, connection: { hostDescription }, sessionId: 'a' })
  assert.equal(store.getSnapshot().state, 'running')
  hostDescription.publish(undefined)
  assert.equal(store.getSnapshot().state, 'unknown')
  hostDescription.publish({ id: 'host-b' })
  face.publish(snapshotOf({ running: false }))
  assert.equal(store.getSnapshot().state, 'unknown')
  list.publish(listOf())
  assert.equal(store.getSnapshot().state, 'unknown')
  face.publish(snapshotOf({ openState: 'loading' }))
  face.publish(snapshotOf())
  assert.equal(store.getSnapshot().state, 'inactive')
  assert.equal(face.size, 1)
  store.dispose(); store.dispose()
  assert.deepEqual([face.size, list.size, hostDescription.size], [0, 0, 0])
})

test('store switches binding and disposes subscriptions without a network or execution owner', () => {
  const list = observable(listOf())
  const a = observable(snapshotOf())
  const b = observable(snapshotOf({ running: true }))
  let face = a
  const hostDescription = observable({ id: 'host' })
  const store = createTimelineStore({ sessions: { list, binding: () => face && ({ session: face }) }, connection: { hostDescription }, sessionId: 'a' })
  face = b
  list.publish(listOf())
  assert.deepEqual([a.size, b.size], [0, 1])
  assert.equal(store.getSnapshot().state, 'running')
  face = undefined
  list.publish(listOf())
  assert.equal(store.getSnapshot().state, 'unloaded')
  assert.equal(b.size, 0)
  store.dispose()
})

test('built native module installs only a Tasks child view and unload disposes registration', async () => {
  const code = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  let plugin
  runInNewContext(code, { window: { __ModuleLoader__: { load: entry => { assert.equal(entry.id, 'dsh-flowglass'); plugin = entry.factory(id => { assert.equal(id, 'react'); return {} }) } } } })
  const disposers = []
  let active = 0
  plugin.apply({ betterSidebar: { registerTaskView(descriptor) { assert.equal(descriptor.id, 'flowglass:timeline'); active++; return () => { active-- } } }, effect(fn) { disposers.push(fn()) } })
  assert.equal(active, 1)
  disposers.forEach(fn => fn())
  assert.equal(active, 0)
  assert.doesNotMatch(code, /\.fork\(|\.create\(|\.prompt\(|\.cancel\(|\.command\(|\.start\(|\.configure\(|registerTab\(/)
  let warned = false
  plugin.apply({ betterSidebar: {}, logger: { warn() { warned = true } } })
  assert.equal(warned, true)
})
