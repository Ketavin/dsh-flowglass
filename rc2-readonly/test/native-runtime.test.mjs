import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { captureTimeline } from '../model.mjs'

// Explicit isolated source, never a production plugin or Provider. tsx loads
// the actual rc.2 Session and business Definitions without copying their fold.
const core = process.env.P5_CORE_ROOT
if (!core) throw new Error('P5_CORE_ROOT must point at the isolated rc.2 Core checkout')
const fromCore = path => import(pathToFileURL(resolve(core, path)).href)
const { Session } = await fromCore('packages/client/runtime/src/client/sessions/session.ts')
const definitions = []
let view
for (const [file, name] of [['assistant', 'assistantDefinition'], ['message', 'messageDefinition'], ['tool', 'toolDefinition'], ['turn-error', 'turnErrorDefinition'], ['turn-tail', 'turnTailDefinition']]) {
  definitions.push((await fromCore(`packages/client/ui-conversation/src/client/conversation-nodes/${file}.ts`))[name])
}
view = (await fromCore('packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts')).chatViewDefinition
const conversation = { events: { entries: () => definitions, fallbackEntry: () => undefined }, views: { entries: () => [view] } }
const at = (seq, type, data, extra = {}) => ({ seq, time: 1700000000000 + seq, type, data, ...extra })
const list = { phase: 'ready', byId: {}, subagentsByParent: {}, jobsBySession: {} }
const message = text => ({ id: 'm1', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'keyless' }, content: [{ type: 'text', text }] })

test('actual rc.2 Session folds legacy chunks, settled assistant and failed tools exactly once', async () => {
  let reads = 0
  const api = { sessions: { history: async () => { reads++; return { result: { ok: true, value: { hasMore: true, events: [
    at(1, 'turn/start', { turn: 1 }), at(2, 'step/start', { turn: 1, step: 0 }),
    at(3, 'assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'live' } }),
  ].map(event => ({ event })) } } } } } }
  const session = new Session('native-keyless', api, {}, { conversation })
  await session.open()
  session.handleRunning(true)
  const capture = () => captureTimeline({ sessionId: 'native-keyless', snapshot: session.getSnapshot(), list, connected: true })
  assert.equal(capture().rows.find(row => row.kind === 'partial')?.body, 'live')
  const publish = event => session.handleMuxEnvelope('fixture-rpc', { type: 'session/event', event })
  publish(at(4, 'assistant/message', { turn: 1, step: 0, message: message('final') }, { surfaceOp: 'append' }))
  publish(at(5, 'tool/call', { turn: 1, step: 0, callId: 'native-call', name: 'read', arguments: '{}' }))
  assert.equal(capture().rows.filter(row => row.kind === 'partial').length, 0)
  assert.equal(capture().rows.find(row => row.kind === 'assistant')?.body, 'final')
  assert.equal(capture().rows.find(row => row.callId === 'native-call')?.state, 'running')
  publish(at(6, 'tool/result', { turn: 1, step: 0, message: { id: 'r1', role: 'user', source: { kind: 'tool', callId: 'native-call' }, content: [{ type: 'tool-result', toolCallId: 'native-call', isError: true, content: [{ type: 'text', text: 'controlled missing file' }] }] } }, { surfaceOp: 'append' }))
  publish(at(7, 'step/end', { turn: 1, step: 0 }))
  publish(at(8, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }))
  session.handleRunning(false)
  const model = capture()
  assert.equal(model.rows.filter(row => row.callId === 'native-call').length, 1)
  assert.equal(model.rows.find(row => row.callId === 'native-call')?.state, 'failed')
  assert.equal(model.state, 'cancelled')
  assert.equal(model.hasMore, true)
  assert.equal(reads, 1)
})
