// Ephemeral reader state: never included in the authored document or history.
const viewState = { active: false, revision: 0, source: '', target: '', conn: '', mode: 'focus', kind: 'all', panelOpen: true };
function canEdit() { return !viewState.active; }

const editControlIds = ['btn-new', 'btn-tpl', 'btn-undo', 'btn-redo', 'btn-conn', 'btn-select', 'btn-group',
  'btn-theme', 'btn-canvas-bg', 'm-add', 'm-connect', 'm-undo', 'settings-new', 'settings-tpl',
  'settings-group', 'settings-theme', 'settings-canvas-bg', 'confirm-new', 'import-file'];

function setViewMode(active) {
  if (viewState.active === active) return;
  viewState.revision++;
  // Commit a pending editor value before entering read-only mode.
  document.activeElement?.blur();
  if (active) {
    setMode('select');
    state.selected.clear();
    state.tempConn = null;
    state.connStart = null;
    selBox.active = false;
    panning = false;
    document.getElementById('sel-box').style.display = 'none';
    document.querySelectorAll('.modal-overlay.open, #mobile-node-menu.open').forEach(el => closeModal(el.id));
    document.getElementById('ctx-menu').classList.remove('open');
  }
  Object.assign(viewState, { active, source: '', target: '', conn: '', mode: 'focus', kind: 'all', panelOpen: true });
  document.body.classList.toggle('view-mode', active);
  document.getElementById('view-strip').hidden = !active;
  for (const id of editControlIds) {
    const el = document.getElementById(id);
    if (el) el.disabled = active;
  }
  ['diagram-name-pc', 'diagram-name-mobile'].forEach(id => { document.getElementById(id).readOnly = active; });
  ['btn-view', 'settings-view'].forEach(id => {
    const el = document.getElementById(id);
    el.setAttribute('aria-pressed', String(active));
    el.textContent = active ? '編集に戻る' : '閲覧モード';
  });
  document.getElementById('st-mode').textContent = active ? '閲覧' : '選択';
  renderSelection();
  updateRightPanel();
  document.getElementById(active ? 'view-exit' : (isMobile() ? 'm-settings' : 'btn-view')).focus();
}

function clearViewFocus() {
  Object.assign(viewState, { source: '', target: '', conn: '' });
  updateView();
}
function focusViewNode(id) {
  if (!state.nodes[id]) return;
  if (viewState.mode === 'route' && viewState.source && viewState.source !== id) viewState.target = id;
  else { viewState.source = id; viewState.target = ''; }
  viewState.conn = '';
  updateView();
}
function focusViewConnection(id) {
  if (!state.conns[id]) return;
  viewState.conn = id;
  viewState.source = state.conns[id].from;
  viewState.target = state.conns[id].to;
  viewState.mode = 'focus';
  updateView();
}
function viewResult() {
  if (viewState.conn && state.conns[viewState.conn]) {
    const c = state.conns[viewState.conn];
    return { nodeIds: [c.from, c.to], connIds: [c.id], message: FlowDraftData.semanticStyle(FlowDraftData.getSemantic(state, c.id)).label };
  }
  if (!viewState.source) return { nodeIds: [], connIds: [], message: 'ノードを選ぶと関連部分を表示します。' };
  if (viewState.mode === 'route') {
    if (!viewState.target) return { nodeIds: [viewState.source], connIds: [], message: '終点を選んでください。' };
    const r = FlowDraftGraph.route(state, viewState.source, viewState.target, viewState.kind);
    return { ...r, message: !r.found ? 'この条件で到達する経路はありません。' : r.multiple ? `同じ長さの最短経路が複数あります。うち1本（${r.connIds.length}接続）を表示。` : `最短経路：${r.connIds.length}接続` };
  }
  if (viewState.mode === 'upstream' || viewState.mode === 'downstream') {
    const r = FlowDraftGraph.reach(state, viewState.source, viewState.mode, viewState.kind);
    return { ...r, message: `${viewState.mode === 'upstream' ? '上流' : '下流'}：${r.nodeIds.length}ノード・${r.connIds.length}接続` };
  }
  const edges = Object.values(state.conns).filter(c => (c.from === viewState.source || c.to === viewState.source) &&
    (viewState.kind === 'all' || FlowDraftData.getSemantic(state, c.id).kind === viewState.kind));
  return { nodeIds: [...new Set([viewState.source, ...edges.flatMap(c => [c.from, c.to])])], connIds: edges.map(c => c.id), message: `直接の接続：${edges.length}本` };
}
function applyViewHighlights() {
  const result = viewState.active ? viewResult() : { nodeIds: [], connIds: [] };
  const nodes = new Set(result.nodeIds), conns = new Set(result.connIds);
  const hasFocus = viewState.active && Boolean(viewState.source || viewState.conn);
  canvas.querySelectorAll('.flow-node').forEach(el => {
    const id = el.id.slice(5);
    el.classList.toggle('view-lit', hasFocus && nodes.has(id));
    el.classList.toggle('view-dim', hasFocus && !nodes.has(id));
  });
  svgLayer.querySelectorAll('[data-conn-id]').forEach(el => {
    el.classList.toggle('view-lit', hasFocus && conns.has(el.dataset.connId));
    el.classList.toggle('view-dim', hasFocus && !conns.has(el.dataset.connId));
  });
  svgLayer.querySelectorAll('[data-group-id]').forEach(el => {
    const lit = state.groups[el.dataset.groupId]?.nodeIds.some(id => nodes.has(id));
    el.classList.toggle('view-lit', hasFocus && lit);
    el.classList.toggle('view-dim', hasFocus && !lit);
  });
  document.getElementById('view-status').textContent = result.message || '図上の接続を確認できます。';
}
function updateView() { applyViewHighlights(); renderViewPanel(); }

function options(map, value) {
  return Object.entries(map).map(([id, label]) => `<option value="${escHtml(id)}"${id === value ? ' selected' : ''}>${escHtml(label)}</option>`).join('');
}
function renderViewPanel() {
  if (!viewState.active) return;
  if (!viewState.panelOpen) { rightPanel.innerHTML = ''; return; }
  const nodeLabels = Object.fromEntries(Object.values(state.nodes).map(n => [n.id, `${n.label || '無題'} (${n.id})`]));
  const n = state.nodes[viewState.source];
  const c = state.conns[viewState.conn];
  const detail = c ? FlowDraftData.getSemantic(state, c.id).description : n?.sublabel;
  rightPanel.innerHTML = `<div class="prop-section view-panel">
    ${panelHeader('図上の経路')}
    <p class="prop-help">図に書かれた接続をたどります。実行ログの表示ではありません。</p>
    <label class="prop-row">始点<select class="prop-select" id="view-source">${options({ '': 'ノードを選択', ...nodeLabels }, viewState.source)}</select></label>
    <label class="prop-row">表示<select class="prop-select" id="view-query">${options({focus:'直接の接続',upstream:'上流',downstream:'下流',route:'2点間の最短経路'},viewState.mode)}</select></label>
    ${viewState.mode === 'route' ? `<label class="prop-row">終点<select class="prop-select" id="view-target">${options({'':'ノードを選択',...nodeLabels},viewState.target)}</select></label>` : ''}
    <label class="prop-row">接続の種類<select class="prop-select" id="view-kind">${options({all:'すべて',...FlowDraftData.KINDS},viewState.kind)}</select></label>
    <p class="view-result" role="status">${escHtml(viewResult().message)}</p>
    ${n ? `<h3>${escHtml(c ? (c.label || '接続') : n.label)}</h3><p class="view-detail">${escHtml(detail || '説明は未設定です。')}</p>` : ''}
    <button class="secondary-btn" id="view-clear">ハイライトを解除</button>
    <details class="semantic-legend"><summary>線の凡例</summary>${Object.entries(FlowDraftData.KINDS).map(([kind,label])=>{
      const s = FlowDraftData.semanticStyle({kind});
      return `<div><svg width="32" height="14" aria-hidden="true"><path d="M0 7H30" stroke="${s.color || 'currentColor'}" stroke-width="2" stroke-dasharray="${s.dash}"/></svg>${label}</div>`;
    }).join('')}<p>エラー・フォールバックは結果として別に設定できます。</p></details>
    <details><summary>接続一覧</summary><div class="view-connections">${Object.values(state.conns).map(edge => `<button class="secondary-btn" data-view-conn="${escHtml(edge.id)}">${escHtml(state.nodes[edge.from]?.label)} → ${escHtml(state.nodes[edge.to]?.label)} · ${escHtml(FlowDraftData.semanticStyle(FlowDraftData.getSemantic(state,edge.id)).label)} (${escHtml(edge.id)})</button>`).join('')}</div></details>
  </div>`;
  document.getElementById('prop-close').addEventListener('click', () => { viewState.panelOpen = false; renderViewPanel(); document.getElementById('view-panel-toggle').focus(); });
  for (const [id, key] of [['view-source','source'],['view-target','target'],['view-query','mode'],['view-kind','kind']]) {
    document.getElementById(id)?.addEventListener('change', e => {
      viewState[key] = e.target.value;
      viewState.conn = '';
      updateView();
      document.getElementById(id)?.focus();
    });
  }
  document.getElementById('view-clear').addEventListener('click', clearViewFocus);
  rightPanel.querySelectorAll('[data-view-conn]').forEach(button => button.addEventListener('click', () => focusViewConnection(button.dataset.viewConn)));
}

function appendSemanticEditor(id) {
  const semantic = FlowDraftData.getSemantic(state, id);
  const section = document.createElement('div');
  section.className = 'prop-section';
  section.innerHTML = `<div class="panel-label">接続の意味</div>
    <label class="prop-row">種類<select class="prop-select" id="conn-kind">${options(FlowDraftData.KINDS,semantic.kind)}</select></label>
    <label class="prop-row">結果<select class="prop-select" id="conn-outcome">${options(FlowDraftData.OUTCOMES,semantic.outcome)}</select></label>
    <label class="prop-row">説明<textarea class="prop-input" id="conn-description" maxlength="4096" rows="3">${escHtml(semantic.description)}</textarea></label>
    <p class="prop-help">未指定の接続は従来の表示を維持します。</p>`;
  rightPanel.firstElementChild.after(section);
  for (const [field, key] of [['conn-kind','kind'],['conn-outcome','outcome'],['conn-description','description']]) {
    document.getElementById(field).addEventListener('change', e => {
      if (!canEdit()) return;
      state.semantics.connections[id] = { ...FlowDraftData.getSemantic(state,id), [key]: e.target.value };
      snapshot(); renderConns();
    });
  }
}

document.getElementById('btn-view').addEventListener('click', () => setViewMode(canEdit()));
document.getElementById('settings-view').addEventListener('click', () => { closeModal('modal-settings'); setViewMode(canEdit()); });
document.getElementById('view-exit').addEventListener('click', () => setViewMode(false));
document.getElementById('view-panel-toggle').addEventListener('click', () => { viewState.panelOpen = !viewState.panelOpen; renderViewPanel(); });

// Capture stale controls opened before a mode transition; functional guards also
// protect asynchronous completions. This is UI read-only, not access control.
document.addEventListener('click', e => {
  if (!canEdit() && e.target.closest(editControlIds.map(id => '#' + id).join(','))) {
    e.preventDefault(); e.stopImmediatePropagation();
  }
}, true);
