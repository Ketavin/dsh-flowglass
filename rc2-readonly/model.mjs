/** Bounded copies of rc.2's already-folded conversation window. No event writes. */
export const MAX_NODES = 240
export const MAX_BODY = 4000
export const MAX_RELATED = 100

const trim = value => typeof value === 'string' ? value.slice(0, MAX_BODY) : ''
const textOf = content => {
  let text = ''
  for (const block of content ?? []) {
    if (block.kind !== 'text' && block.kind !== 'reasoning' && block.type !== 'text') continue
    text += `${text ? '\n' : ''}${trim(block.text)}`
    if (text.length >= MAX_BODY) return text.slice(0, MAX_BODY)
  }
  return text
}
const terminalStates = new Map(Object.entries({ completed: 'completed', aborted: 'cancelled', error: 'failed', interrupted: 'interrupted', blocked: 'blocked', 'max-tokens': 'max-tokens' }))
const settled = reason => terminalStates.get(reason) ?? 'unknown'

export function captureTimeline({ sessionId, snapshot, list, connected, baselineReady = true, relatedReady = baselineReady, jobsReady = baselineReady }) {
  const synchronized = connected && baselineReady && list.phase === 'ready'
  const rows = []
  const calls = new Set()
  let omitted = 0
  const add = row => { rows.push(Object.freeze(row)) }
  const tool = (call, parentCallId, depth = 0) => {
    if (!call || calls.has(call.callId)) return
    if (depth > 8 || calls.size >= MAX_NODES) { omitted++; return }
    calls.add(call.callId)
    const complete = call.kind === 'tool-result'
    add({ key: `tool:${call.callId}`, kind: 'tool', label: trim(complete ? call.call?.name ?? call.callId : call.name),
      callId: call.callId, parentCallId, seq: complete ? call.seq : undefined, time: call.time,
      state: complete ? call.isError ? 'failed' : 'completed' : synchronized && snapshot?.running ? 'running' : 'unknown',
      body: trim(complete ? textOf(call.content) : call.argsRaw), detail: trim(complete ? call.call?.argsRaw : ''),
    })
    const children = call.subCalls ?? []
    const remaining = Math.max(0, MAX_NODES - calls.size)
    omitted += Math.max(0, children.length - remaining)
    for (const child of children.slice(0, remaining)) tool(child, call.callId, depth + 1)
  }
  const nodes = snapshot?.nodes ?? []
  // Keep a bounded tail; counts make omitted history explicit.
  omitted += Math.max(0, nodes.length - MAX_NODES)
  const tail = nodes.slice(-MAX_NODES)
  for (const node of tail) {
    if (node.kind === 'tool-result') { tool(node); continue }
    const body = node.kind === 'assistant' ? textOf(node.blocks) : node.kind === 'turn-error' ? trim(node.message) : textOf(node.content)
    add({ key: `${node.kind}:${node.seq}`, kind: node.kind, seq: node.seq, time: node.time,
      label: node.kind, state: node.kind === 'turn-error' ? 'failed' : node.interrupted ? 'interrupted' : 'recorded', body,
    })
  }
  const running = snapshot?.runningCalls ?? []
  omitted += Math.max(0, running.length - MAX_NODES)
  for (const call of running.slice(-MAX_NODES)) tool(call)
  const partial = snapshot?.partial
  if (partial && !tail.some(node => node.kind === 'assistant' && node.turn === partial.turn && node.step === partial.step)) {
    add({ key: `partial:${partial.turn}:${partial.step}`, kind: 'partial', label: 'assistant',
      state: synchronized && snapshot.running ? 'streaming' : 'unknown', body: textOf(partial.blocks),
    })
  }
  const timeline = snapshot?.chat?.timeline
  const turnIds = timeline?.turnOrder ?? []
  for (const turnId of turnIds.slice(-MAX_NODES)) {
    const turn = timeline.turns.get(turnId)
    if (!turn) continue
    const end = turn.end
    if (end) add({ key: `turn:${turnId}`, kind: 'turn', label: `Turn ${turnId}`, seq: end.seq, time: end.time,
      state: settled(end.data.reason.kind), body: trim(end.data.reason.error?.message),
    })
  }
  rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || (a.seq ?? Infinity) - (b.seq ?? Infinity))
  omitted += Math.max(0, rows.length - MAX_NODES)
  const latestTurn = timeline?.turns.get(turnIds.at(-1))
  const state = !synchronized ? 'unknown' : !snapshot || snapshot.openState !== 'open' ? 'unloaded'
    : snapshot.running ? 'running' : latestTurn?.end ? settled(latestTurn.end.data.reason.kind) : 'inactive'
  const catalog = list.subagentsByParent?.[sessionId]
  const related = (catalog?.entries ?? []).slice(0, MAX_RELATED).map(entry => Object.freeze({
    id: entry.id, label: trim(entry.label ?? list.byId[entry.id]?.displayTitle ?? entry.id),
    state: !synchronized || !relatedReady ? 'unknown' : entry.kind === 'diagnostic' ? entry.reason : entry.activity,
    address: entry.kind === 'child' ? Object.freeze({ parentSessionId: sessionId, childSessionId: entry.id, mode: entry.mode }) : undefined,
    hasChildren: entry.kind === 'child' && entry.hasChildren,
  }))
  const jobs = (list.jobsBySession?.[sessionId] ?? []).slice(0, MAX_RELATED).map(job => Object.freeze({
    id: job.id, kind: job.kind, label: trim(job.label), state: synchronized && jobsReady ? job.status : 'unknown',
    detail: trim(job.detail), startedAt: job.startedAt, finishedAt: job.finishedAt,
  }))
  return Object.freeze({ sessionId, state, synchronized, openState: snapshot?.openState ?? 'unloaded',
    error: trim(snapshot?.openError?.message ?? snapshot?.lastAgentError), hasMore: snapshot?.hasMore ?? true,
    omitted, rows: Object.freeze(rows.slice(-MAX_NODES)), related: Object.freeze(related), jobs: Object.freeze(jobs),
    catalogState: synchronized && relatedReady ? catalog?.state ?? 'unloaded' : 'unknown', relatedMore: Math.max(0, (catalog?.entries.length ?? 0) - MAX_RELATED),
    jobsMore: Math.max(0, (list.jobsBySession?.[sessionId]?.length ?? 0) - MAX_RELATED),
  })
}

/** Subscriptions are owned by one visible view; never start a second Host stream. */
export function createTimelineStore({ sessions, connection, sessionId }) {
  const listeners = new Set()
  let disposed = false
  let description = connection.hostDescription.getSnapshot()
  let baselineReady = description !== undefined
  let baselineList = sessions.list.getSnapshot()
  let waitingForWindow = false
  let sawLoading = false
  let relatedReady = baselineReady
  let jobsReady = baselineReady
  let face
  let stopFace = () => {}
  let value
  const publish = () => {
    if (disposed) return
    const next = sessions.binding(sessionId)?.session
    if (next !== face) {
      stopFace()
      face = next
      stopFace = face?.subscribe(publish) ?? (() => {})
    }
    const snapshot = face?.getSnapshot()
    const list = sessions.list.getSnapshot()
    if (waitingForWindow && description !== undefined) {
      if (snapshot?.openState === 'loading' || snapshot?.openState === 'cold') sawLoading = true
      if (sawLoading && snapshot?.openState === 'open') { waitingForWindow = false; baselineReady = true }
    }
    if (description !== undefined) {
      if (list.subagentsByParent?.[sessionId] !== baselineList.subagentsByParent?.[sessionId]
        && list.subagentsByParent?.[sessionId]?.state === 'ready') relatedReady = true
      if (list.jobsBySession?.[sessionId] !== baselineList.jobsBySession?.[sessionId]) jobsReady = true
    }
    value = captureTimeline({ sessionId, snapshot, list, connected: description !== undefined, baselineReady, relatedReady, jobsReady })
    for (const listener of [...listeners]) listener()
  }
  const stopList = sessions.list.subscribe(publish)
  const stopHost = connection.hostDescription.subscribe(() => {
    const next = connection.hostDescription.getSnapshot()
    if (next !== description) {
      description = next
      baselineReady = false
      relatedReady = false
      jobsReady = false
      waitingForWindow = true
      sawLoading = false
      baselineList = sessions.list.getSnapshot()
    }
    publish()
  })
  publish()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    dispose() { if (disposed) return; disposed = true; stopFace(); stopList(); stopHost(); listeners.clear() },
  }
}
