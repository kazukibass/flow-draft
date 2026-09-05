// Ephemeral reader state: never included in the authored document or history.
const viewState = { active: false, revision: 0, source: '', conn: '', panelOpen: false };
function canEdit() { return !viewState.active; }

const editControlIds = ['btn-new', 'btn-tpl', 'btn-undo', 'btn-redo', 'btn-conn', 'btn-select', 'btn-group',
  'btn-theme', 'btn-canvas-bg', 'm-add', 'm-connect', 'm-undo', 'm-group', 'settings-new', 'settings-tpl',
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
  Object.assign(viewState, { active, source: '', conn: '', panelOpen: false });
  document.body.classList.toggle('view-mode', active);
  document.getElementById('view-strip').hidden = !active;
  document.getElementById('view-panel-toggle').setAttribute('aria-expanded', 'false');
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
  Object.assign(viewState, { source: '', conn: '' });
  updateView();
}
function focusViewNode(id) {
  if (!state.nodes[id]) return;
  viewState.source = id;
  viewState.conn = '';
  updateView();
}
function focusViewConnection(id) {
  if (!state.conns[id]) return;
  viewState.conn = id;
  viewState.source = state.conns[id].from;
  updateView();
}
function viewResult() {
  if (viewState.conn && state.conns[viewState.conn]) {
    const c = state.conns[viewState.conn];
    return { nodeIds: [c.from, c.to], connIds: [c.id], message: FlowDraftData.semanticStyle(FlowDraftData.getSemantic(state, c.id)).label };
  }
  if (!viewState.source) return { nodeIds: [], connIds: [], message: 'ノードか線を触ってください。' };
  const edges = Object.values(state.conns).filter(c => c.from === viewState.source || c.to === viewState.source);
  return { nodeIds: [...new Set([viewState.source, ...edges.flatMap(c => [c.from, c.to])])], connIds: edges.map(c => c.id), message: `このノードにつながる線：${edges.length}本` };
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
  const n = state.nodes[viewState.source];
  const c = state.conns[viewState.conn];
  const detail = c ? FlowDraftData.getSemantic(state, c.id).description : n?.sublabel;
  const edges = n ? Object.values(state.conns).filter(edge => edge.from === n.id || edge.to === n.id) : [];
  rightPanel.innerHTML = `<div class="prop-section view-panel">
    ${panelHeader('詳細')}
    ${n ? `<p class="view-result" role="status">${escHtml(viewResult().message)}</p>
      <h3>${escHtml(c ? (c.label || `${state.nodes[c.from]?.label} → ${state.nodes[c.to]?.label}`) : n.label)}</h3>
      <p class="view-detail">${escHtml(detail || '説明は未設定です。')}</p>
      ${!c && edges.length ? `<div class="view-connection-list">${edges.map(edge => {
        const semantic = FlowDraftData.semanticStyle(FlowDraftData.getSemantic(state, edge.id));
        return `<div class="view-connection-item"><strong>${escHtml(state.nodes[edge.from]?.label)} → ${escHtml(state.nodes[edge.to]?.label)}</strong>${escHtml(edge.label || semantic.label)}</div>`;
      }).join('')}</div>` : ''}` : '<p class="view-empty">ノードか線を触ると、ここに詳細を表示します。</p>'}
    <details class="semantic-legend"><summary>線の凡例</summary>${Object.entries(FlowDraftData.KINDS).map(([kind,label])=>{
      const s = FlowDraftData.semanticStyle({kind});
      return `<div><svg width="32" height="14" aria-hidden="true"><path d="M0 7H30" stroke="${s.color || 'currentColor'}" stroke-width="2" stroke-dasharray="${s.dash}"/></svg>${label}</div>`;
    }).join('')}<p>線の種類や説明は編集モードで設定します。</p></details>
  </div>`;
  document.getElementById('prop-close').addEventListener('click', () => {
    viewState.panelOpen = false;
    document.getElementById('view-panel-toggle').setAttribute('aria-expanded', 'false');
    renderViewPanel();
    document.getElementById('view-panel-toggle').focus();
  });
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
document.getElementById('view-panel-toggle').addEventListener('click', () => {
  viewState.panelOpen = !viewState.panelOpen;
  document.getElementById('view-panel-toggle').setAttribute('aria-expanded', String(viewState.panelOpen));
  renderViewPanel();
});

// Capture stale controls opened before a mode transition; functional guards also
// protect asynchronous completions. This is UI read-only, not access control.
document.addEventListener('click', e => {
  if (!canEdit() && e.target.closest(editControlIds.map(id => '#' + id).join(','))) {
    e.preventDefault(); e.stopImmediatePropagation();
  }
}, true);
