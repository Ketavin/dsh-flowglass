import { captureTimeline, createTimelineStore } from './model.mjs'

/** React is supplied by the existing Host module table, never bundled again. */
export function makePlugin(React) {
  const { createElement: h, useEffect, useState } = React
  const labels = { unknown: '状态未知 / 同步中', unloaded: '未加载', inactive: '当前未运行', running: '运行中', streaming: '生成中', completed: '已完成',
    failed: '失败', cancelled: '已取消', interrupted: '中断', blocked: '受阻', 'max-tokens': '达到输出上限', recorded: '已记录', stopping: '停止中', killed: '已终止', unavailable: '不可用', corrupt: '数据损坏', unsupported: '不支持' }
  const text = state => Object.hasOwn(labels, state) ? labels[state] : String(state)
  const CSS = `
.flowglass-rc2{height:100%;overflow:auto;padding:12px;box-sizing:border-box;overflow-wrap:anywhere;font:var(--dsw-font-s-14,normal 400 14px/1.5 system-ui,sans-serif);color:var(--dsw-alias-label-primary,inherit)}
.flowglass-rc2 button,.flowglass-rc2 select{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:6px;padding:4px 8px;max-width:100%}
.flowglass-rc2 button:not(:disabled):hover,.flowglass-rc2 select:hover{background:var(--dsw-alias-interactive-bg-hover,#8881)}
.flowglass-rc2 button:disabled{opacity:.5;cursor:default}
.flowglass-rc2 :is(button,select,summary):focus-visible{outline:2px solid var(--dsw-alias-label-link,#5188e8);outline-offset:2px}
.flowglass-rc2 header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.flowglass-rc2 header strong{font-weight:600}
.flowglass-rc2 header [role=status]{font-size:12px;border-radius:4px;padding:2px 6px;background:var(--dsw-alias-interactive-bg-hover,#8881)}
.flowglass-rc2 p{margin:8px 0}
.flowglass-rc2 ol{list-style:none;padding:0;margin:10px 0}
.flowglass-rc2 li{border-left:2px solid var(--dsw-alias-border-l2,#8886);padding:8px 10px;margin-left:4px}
.flowglass-rc2 small{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
.flowglass-rc2 [data-state=failed]{border-color:#d75c59}
.flowglass-rc2 pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--dsw-alias-interactive-bg-hover,#8881);border-radius:6px;padding:8px}
.flowglass-rc2 summary{cursor:pointer;color:var(--dsw-alias-label-secondary,inherit)}
.flowglass-rc2 section{margin-top:16px}
.flowglass-rc2 h3{font-size:inherit;font-weight:600;margin:6px 0}
`
  function TimelineView({ ctx, scope, visible, onSubagentJump }) {
    const initial = () => captureTimeline({ sessionId: scope.sessionId, snapshot: undefined, list: ctx.sessions.list.getSnapshot(), connected: false })
    const [model, setModel] = useState(initial)
    const [filter, setFilter] = useState('all')
    useEffect(() => {
      setModel(initial())
      if (!visible) return
      const store = createTimelineStore({ sessions: ctx.sessions, connection: ctx.connection, sessionId: scope.sessionId })
      const update = () => setModel(store.getSnapshot())
      const off = store.subscribe(update)
      update()
      return () => { off(); store.dispose() }
    }, [ctx, scope.sessionId, visible])
    const openChild = row => {
      if (!model.synchronized || model.catalogState !== 'ready' || !row.address) return
      ctx.sessions.openSubagent(row.address)
      onSubagentJump?.(row.id)
    }
    const rows = model.rows.filter(row => filter === 'all' || filter === 'tools' && row.kind === 'tool' || filter === 'failures' && row.state === 'failed')
    return h('div', { className: 'flowglass-rc2', 'data-flowglass-readonly': true },
      h('style', null, CSS),
      h('header', null, h('strong', null, '执行过程'), h('span', { role: 'status' }, text(model.state)),
        h('select', { 'aria-label': '执行过程筛选', value: filter, onChange: event => setFilter(event.target.value) },
          h('option', { value: 'all' }, '全部'), h('option', { value: 'tools' }, '工具'), h('option', { value: 'failures' }, '失败'))),
      h('p', null, h('small', null, `只读 · 当前已加载窗口${model.hasMore ? '（更早历史未加载）' : ''} · 最多 240 项${model.omitted ? ` · 省略 ${model.omitted} 项` : ''}`)),
      !model.synchronized && h('p', { role: 'alert' }, '连接或新基线尚未就绪；以下历史不代表当前执行状态。'),
      model.openState !== 'open' && h('p', null, '尚未加载此会话的执行窗口，请在主对话中打开后查看。'),
      model.error && h('p', { role: 'alert' }, model.error),
      h('ol', { 'aria-label': '执行时间线' }, rows.map(row => h('li', { key: row.key, 'data-state': row.state },
        h('strong', null, row.label), ' · ', text(row.state),
        h('div', null, h('small', null, [row.seq === undefined ? '' : `seq ${row.seq}`, row.callId ?? '', row.parentCallId ? `父调用 ${row.parentCallId}` : ''].filter(Boolean).join(' · '))),
        (row.body || row.detail) && h('details', null, h('summary', null, '查看内容（最多 4000 字符）'), row.detail && h('pre', null, row.detail), row.body && h('pre', null, row.body))))),
      h('section', { 'aria-label': '直接子代理' }, h('h3', null, '直接子代理'),
        model.catalogState !== 'ready' && h('p', null, `目录 ${text(model.catalogState)}；原生 Tasks 页负责目录加载。`),
        h('ol', null, model.related.map(row => h('li', { key: row.id }, h('button', { type: 'button', disabled: !model.synchronized || model.catalogState !== 'ready' || !row.address, onClick: () => openChild(row) }, row.label), ' · ', text(row.state), row.hasChildren && h('small', null, ' · 含下一层')))),
        model.relatedMore > 0 && h('small', null, `另有 ${model.relatedMore} 项，请在原生 Tasks 查看`)),
      h('section', { 'aria-label': '后台任务' }, h('h3', null, '后台任务'), h('ol', null, model.jobs.map(job => h('li', { key: job.id, 'data-state': job.state }, job.label, ' · ', text(job.state), h('small', null, ` · ${job.kind} ${job.id}`), job.detail && h('p', null, job.detail)))),
        model.jobsMore > 0 && h('small', null, `另有 ${model.jobsMore} 项，请在原生 Tasks 查看`)),
    )
  }
  return {
    name: 'dsh-flowglass/client', inject: ['betterSidebar', 'sessions', 'connection'],
    apply(ctx) {
      if (typeof ctx.betterSidebar.registerTaskView !== 'function') {
        ctx.logger.warn('Flowglass requires the taskViews Sidebar extension; no fallback rail was installed.')
        return
      }
      ctx.effect(() => ctx.betterSidebar.registerTaskView({ id: 'flowglass:timeline', title: '执行过程', order: 20, component: TimelineView }))
    },
  }
}
