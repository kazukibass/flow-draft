// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
const state = {
  nodes: {},
  conns: {},
  groups: {},
  schemaVersion: 1,
  semantics: { connections: {} },
  zoom: 1,
  panX: 0,
  panY: 0,
  selected: new Set(),
  mode: 'select',
  nextId: 1,
  dragging: null,
  connStart: null,
  tempConn: null,
  history: [],
  historyIdx: -1,
  dirty: false,
  theme: 'light',
};

const MOBILE_BREAKPOINT = 900;

const NODE_TYPES = [
  { type: 'start',      label: '開始',       color: '#4ade80', shape: 'circle'     },
  { type: 'end',        label: '終了',       color: '#f87171', shape: 'circle'     },
  { type: 'process',    label: 'プロセス',   color: '#5b9cf6', shape: 'rect'       },
  { type: 'decision',   label: '分岐',       color: '#fbbf24', shape: 'diamond'    },
  { type: 'io',         label: 'I/O',        color: '#2dd4bf', shape: 'para'       },
  { type: 'db',         label: 'DB',         color: '#2dd4bf', shape: 'db'         },
  { type: 'api',        label: 'API',        color: '#a78bfa', shape: 'dashed'     },
  { type: 'loop-start', label: 'ループ開始', color: '#6ab6f4', shape: 'loop-start' },
  { type: 'loop-end',   label: 'ループ終了', color: '#f8a071', shape: 'loop-end'   },
];

// 順: 終了, ループエンド, 分岐, 開始, ループスタート, プロセス, API, 白系×2
const COLORS_LIGHT = [
  '#ffd0d0', '#f3d19a', '#ffecb2', '#97ffbd', '#afe4f6', '#a8c5fc', '#dfcdfc',
  '#ffffff', '#ece7d3',
];
const COLORS_DARK = [
  '#3e1818', '#301c0b', '#47360a', '#123312', '#0a1a29', '#13133a', '#1b0e29',
  '#2b2e34', '#3b4048',
];

// ──────────────────────────────────────────────
// DOM refs
// ──────────────────────────────────────────────
const canvasWrap = document.getElementById('canvas-wrap');
const canvas     = document.getElementById('canvas');
const svgLayer   = document.getElementById('svg-layer');
const rightPanel = document.getElementById('right-panel');
const notif      = document.getElementById('notif');

// ──────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────
function uid() { return 'n' + (state.nextId++); }
function cid() { return 'c' + (state.nextId++); }
function gid() { return 'g' + (state.nextId++); }
let notifTimer;
function notify(msg) {
  notif.textContent = msg;
  notif.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => notif.classList.remove('show'), 2000);
}
let modalReturnFocus = null;
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  modalReturnFocus = document.activeElement;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => el.querySelector('input:not([type="file"]), button, [tabindex="0"]')?.focus());
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (modalReturnFocus?.focus) modalReturnFocus.focus();
  modalReturnFocus = null;
}
window.closeModal = closeModal;

function canvasToWorld(cx, cy) {
  return { x: (cx - state.panX) / state.zoom, y: (cy - state.panY) / state.zoom };
}
function clientToCanvas(e) {
  const rect  = canvasWrap.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}
function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

// ──────────────────────────────────────────────
// DIAGRAM NAME (PC: #diagram-name-pc / Mobile: #diagram-name-mobile)
// ──────────────────────────────────────────────
function getDiagramNameEl() {
  return document.getElementById('diagram-name-pc')
      || document.getElementById('diagram-name-mobile');
}
function getDiagramName() {
  return getDiagramNameEl()?.value || '無題のフロー';
}
function setDiagramName(value) {
  const pc     = document.getElementById('diagram-name-pc');
  const mobile = document.getElementById('diagram-name-mobile');
  if (pc)     pc.value     = value;
  if (mobile) mobile.value = value;
}
document.getElementById('diagram-name-pc')?.addEventListener('input', e => {
  setDiagramName(e.target.value); autosave();
});
document.getElementById('diagram-name-mobile')?.addEventListener('input', e => {
  setDiagramName(e.target.value); autosave();
});

// ──────────────────────────────────────────────
// HISTORY
// ──────────────────────────────────────────────
function snapshot() {
  if (!canEdit()) return;
  Object.keys(state.semantics.connections).forEach(id => {
    if (!state.conns[id]) delete state.semantics.connections[id];
  });
  const s = JSON.stringify(getDocument());
  state.history = state.history.slice(0, state.historyIdx + 1);
  state.history.push(s);
  if (state.history.length > 80) state.history.shift();
  state.historyIdx = state.history.length - 1;
  state.dirty = true;
  autosave();
}
function undo() {
  if (!canEdit()) return;
  if (state.historyIdx <= 0) return;
  state.historyIdx--;
  restore(JSON.parse(state.history[state.historyIdx]));
}
function redo() {
  if (!canEdit()) return;
  if (state.historyIdx >= state.history.length - 1) return;
  state.historyIdx++;
  restore(JSON.parse(state.history[state.historyIdx]));
}
function restore(data) {
  if (!canEdit()) return;
  const saveBlocked = state.saveBlocked;
  applyDocument(data);
  state.saveBlocked = saveBlocked;
  renderAll();
  autosave();
}

function getDocument() {
  return FlowDraftData.serializeDocument({ ...state, name: getDiagramName() });
}

function applyDocument(raw) {
  if (!canEdit()) return;
  const doc = FlowDraftData.normalizeDocument(raw);
  for (const key of ['nodes', 'conns', 'groups', 'nextId', 'schemaVersion', 'semantics']) state[key] = doc[key];
  setDiagramName(doc.name);
  state.saveBlocked = false;
  state.selected.clear();
}

// ──────────────────────────────────────────────
// PANEL EXCLUSIVITY (left <-> right)
// ──────────────────────────────────────────────
function openLeftPanel() {
  if (!canEdit()) return;
  openModal('mobile-node-menu');
  if (isMobile()) {
    rightPanel.innerHTML = '';
    state.selected.clear();
    renderSelection();
  }
}
function openRightPanel() {
  if (isMobile()) closeModal('mobile-node-menu');
}
function closeRightPanel() {
  state.selected.clear();
  renderSelection();
  updateRightPanel();
}
function bindPanelClose() {
  document.getElementById('prop-close')?.addEventListener('click', closeRightPanel);
}
function panelHeader(title) {
  return `<div class="prop-header"><div class="panel-label">${title}</div><button class="panel-close" id="prop-close" type="button" aria-label="プロパティを閉じる">×</button></div>`;
}
// mobile-node-menu：背景タップで閉じる
document.getElementById('mobile-node-menu')?.addEventListener('click', e => {
  // .modal の中身をタップした時は閉じない、背景部分のみ
  if (!e.target.closest('.modal')) closeModal('mobile-node-menu');
});
// ──────────────────────────────────────────────
// PALETTE
// ──────────────────────────────────────────────
function shapePreviewSVG(t) {
  const c = t.color;
  const s = `<svg width="28" height="20" viewBox="0 0 28 20">`;
  if (t.shape === 'circle')     return s + `<ellipse cx="14" cy="10" rx="9" ry="7" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`;
  if (t.shape === 'diamond')    return s + `<polygon points="14,2 26,10 14,18 2,10" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`;
  if (t.shape === 'para')       return s + `<polygon points="5,16 8,4 23,4 20,16" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`;
  if (t.shape === 'dashed')     return s + `<rect x="3" y="4" width="22" height="12" rx="2" fill="none" stroke="${c}" stroke-width="1.2" stroke-dasharray="3,2"/></svg>`;
  if (t.shape === 'loop-start') return s + `<rect x="3" y="4" width="22" height="12" rx="6 6 0 0" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`;
  if (t.shape === 'loop-end')   return s + `<rect x="3" y="4" width="22" height="12" rx="0 0 6 6" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`;
  return s + `<rect x="3" y="4" width="22" height="12" rx="2" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`;
}

function createPaletteItem(t, draggable = true) {
  const el = document.createElement('div');
  el.className    = 'palette-item';
  el.draggable    = draggable;
  el.dataset.type = t.type;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `${t.label}ノードを追加`);
  el.innerHTML    = `<div class="shape-preview">${shapePreviewSVG(t)}</div><div class="shape-label">${t.label}</div>`;
  if (draggable) {
    el.addEventListener('dragstart', e => e.dataTransfer.setData('nodeType', t.type));
    el.addEventListener('touchstart', paletteTouchStart, { passive: true });
  }
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const centerX = (-state.panX + canvasWrap.clientWidth / 2) / state.zoom;
    const centerY = (-state.panY + canvasWrap.clientHeight / 2) / state.zoom;
    addNode(t.type, centerX - 70, centerY - 20);
    closeModal('mobile-node-menu');
    notify(`${t.label}を追加`);
  });
  return el;
}

function buildPalette() {
  const palette    = document.getElementById('palette');
  const mobileGrid = document.getElementById('mobile-node-grid');
  if (palette)    { palette.innerHTML    = ''; NODE_TYPES.forEach(t => palette.appendChild(createPaletteItem(t, true))); }
  if (mobileGrid) { mobileGrid.innerHTML = ''; NODE_TYPES.forEach(t => mobileGrid.appendChild(createPaletteItem(t, false))); }
}

let paletteDragType = null, paletteDragEl = null;
function paletteTouchStart(e) {
  paletteDragType = e.currentTarget.dataset.type;
  paletteDragEl = document.createElement('div');
  paletteDragEl.style.cssText = `position:fixed;width:80px;height:36px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text2);pointer-events:none;z-index:9999;opacity:0.9;`;
  paletteDragEl.textContent = NODE_TYPES.find(n => n.type === paletteDragType)?.label || paletteDragType;
  document.body.appendChild(paletteDragEl);
  document.addEventListener('touchmove', paletteTouchMove, { passive: false });
  document.addEventListener('touchend',  paletteTouchEnd);
}
function paletteTouchMove(e) {
  e.preventDefault();
  const t = e.touches[0];
  paletteDragEl.style.left = (t.clientX - 40) + 'px';
  paletteDragEl.style.top  = (t.clientY - 18) + 'px';
}
function paletteTouchEnd(e) {
  document.removeEventListener('touchmove', paletteTouchMove);
  document.removeEventListener('touchend',  paletteTouchEnd);
  if (paletteDragEl) { paletteDragEl.remove(); paletteDragEl = null; }
  if (!paletteDragType) return;
  const t    = e.changedTouches[0];
  const rect = canvasWrap.getBoundingClientRect();
  if (t.clientX >= rect.left && t.clientX <= rect.right &&
      t.clientY >= rect.top  && t.clientY <= rect.bottom) {
    // タッチでのパレットドロップは画面中央に配置
    const centerX = (-state.panX + canvasWrap.clientWidth  / 2) / state.zoom;
    const centerY = (-state.panY + canvasWrap.clientHeight / 2) / state.zoom;
    addNode(paletteDragType, centerX - 70, centerY - 20);
  }
  paletteDragType = null;
}

// ──────────────────────────────────────────────
// NODES
// ──────────────────────────────────────────────
function addNode(type, x, y, label, sublabel, color, bgColor) {
  if (!canEdit()) return;
  const id  = uid();
  const def = NODE_TYPES.find(t => t.type === type) || NODE_TYPES[2];
  state.nodes[id] = {
    id, type, x, y,
    w:        type === 'decision' ? 165 : 140,
    label:    label    ?? def.label,
    sublabel: sublabel ?? '',
    color:    color    ?? '',
    bgColor:  bgColor  ?? '',
  };
  snapshot();
  renderNode(id);
  renderConns();
  updateStatus();
  return id;
}

function renderNode(id) {
  const n = state.nodes[id];
  let el  = document.getElementById('node-' + id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'node-' + id; el.className = 'flow-node';
    canvas.appendChild(el);
    attachNodeEvents(el, id);
  }
  el.className    = `flow-node node-${n.type}${state.selected.has(id) ? ' selected' : ''}`;
  el.style.left   = n.x + 'px';
  el.style.top    = n.y + 'px';
  el.style.width  = n.w + 'px';
  el.style.background = '';

  if (n.bgColor) {
    if (n.type === 'decision') el.style.setProperty('--node-decision-bg', n.bgColor);
  } else {
    el.style.removeProperty('--node-decision-bg');
  }

  const isDecision = n.type === 'decision';
  const typeLabel  = NODE_TYPES.find(t => t.type === n.type)?.label || n.type;
  const showType   = n.label.trim() !== typeLabel;
  const bodyStyle  = (n.bgColor && !isDecision) ? ` style="background:${n.bgColor}"` : '';
  const inner      = `${isDecision || !showType ? '' : `<div class="node-type">${typeLabel}</div>`}<div class="node-label" id="label-${id}">${escHtml(n.label)}</div>${n.sublabel ? `<div class="node-sublabel">${escHtml(n.sublabel)}</div>` : ''}`;

  el.innerHTML = `<div class="node-inner">${isDecision && showType ? `<div class="node-type">${typeLabel}</div>` : ''}<div class="node-body"${bodyStyle}>${inner}</div><div class="port top" data-port="top" data-node="${id}"></div><div class="port bottom" data-port="bottom" data-node="${id}"></div><div class="port left" data-port="left" data-node="${id}"></div><div class="port right" data-port="right" data-node="${id}"></div><div class="resize-handle" data-node="${id}"></div></div>`;
  el.querySelectorAll('.port').forEach(p => {
    p.addEventListener('mousedown', portMouseDown);
    p.addEventListener('touchstart', portTouchStart, { passive: false });
  });
  el.querySelector('.resize-handle').addEventListener('mousedown', resizeMouseDown);
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function removeNode(id) {
  if (!canEdit()) return;
  const el = document.getElementById('node-' + id);
  if (el) el.remove();
  delete state.nodes[id];
  Object.values(state.groups).forEach(group => {
    group.nodeIds = group.nodeIds.filter(nodeId => nodeId !== id);
  });
  Object.keys(state.groups).forEach(groupId => {
    if (state.groups[groupId].nodeIds.length < 2) delete state.groups[groupId];
  });
  Object.keys(state.conns).forEach(cid => {
    const c = state.conns[cid];
    if (c.from === id || c.to === id) { removeConnEl(cid); delete state.conns[cid]; }
  });
  state.selected.delete(id);
  snapshot(); renderConns(); updateStatus(); updateRightPanel();
}

function renderAll() {
  canvas.querySelectorAll('.flow-node').forEach(el => el.remove());
  svgLayer.innerHTML = '';
  Object.keys(state.nodes).forEach(id => renderNode(id));
  renderConns(); updateStatus(); updateRightPanel(); drawMinimap();
  applyViewHighlights();
}

// ──────────────────────────────────────────────
// NODE DRAG
// ──────────────────────────────────────────────
let dragState = null;
function attachNodeEvents(el, id) {
  el.addEventListener('click', () => { if (!canEdit()) focusViewNode(id); });
  el.addEventListener('mousedown',   e => nodeMouseDown(e, id));
  el.addEventListener('touchstart',  e => nodeTouchStart(e, id), { passive: false });
  el.addEventListener('dblclick',    e => { e.stopPropagation(); startEditLabel(id); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, id); });
}

function nodeMouseDown(e, id) {
  if (!canEdit()) return;
  if (e.button !== 0) return;
  if (e.target.classList.contains('port') || e.target.classList.contains('resize-handle')) return;
  e.stopPropagation();
  if (state.mode === 'group') {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    renderSelection(); updateMobileGroupToolbar();
    return;
  }
  if (state.mode === 'connect') return;
  if (!e.shiftKey && !state.selected.has(id)) state.selected.clear();
  state.selected.add(id);
  renderSelection(); updateRightPanel();
  const startCPos = clientToCanvas(e);
  const offsets   = {};
  state.selected.forEach(sid => {
    const n = state.nodes[sid];
    offsets[sid] = { dx: n.x - canvasToWorld(startCPos.x, startCPos.y).x, dy: n.y - canvasToWorld(startCPos.x, startCPos.y).y };
  });
  dragState = { offsets, moved: false };
  const onMove = e2 => {
    if (!canEdit()) return;
    const cp = clientToCanvas(e2), w = canvasToWorld(cp.x, cp.y);
    state.selected.forEach(sid => {
      const n = state.nodes[sid];
      n.x = Math.round((w.x + offsets[sid].dx) / 8) * 8;
      n.y = Math.round((w.y + offsets[sid].dy) / 8) * 8;
      const el = document.getElementById('node-' + sid);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    renderConns(); dragState.moved = true; drawMinimap();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    if (dragState?.moved) snapshot();
    dragState = null;
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function nodeTouchStart(e, id) {
  if (!canEdit()) return;
  if (e.target.classList.contains('port')) return;
  e.stopPropagation();
  if (state.mode === 'group') {
    e.preventDefault();
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    renderSelection(); updateMobileGroupToolbar();
    return;
  }
  if (state.mode === 'connect') return;
  const t0 = e.touches[0], startCPos = clientToCanvas(t0);
  if (!e.shiftKey && !state.selected.has(id)) state.selected.clear();
  state.selected.add(id);
  renderSelection(); openRightPanel(); updateRightPanel();
  const offsets = {};
  state.selected.forEach(sid => {
    const n = state.nodes[sid], w = canvasToWorld(startCPos.x, startCPos.y);
    offsets[sid] = { dx: n.x - w.x, dy: n.y - w.y };
  });
  let moved  = false;
  const nodeEl = document.getElementById('node-' + id);
  const onMove = e2 => {
    if (!canEdit()) return;
    e2.preventDefault();
    const cp = clientToCanvas(e2.touches[0]), w = canvasToWorld(cp.x, cp.y);
    state.selected.forEach(sid => {
      const n = state.nodes[sid];
      n.x = Math.round((w.x + offsets[sid].dx) / 8) * 8;
      n.y = Math.round((w.y + offsets[sid].dy) / 8) * 8;
      const el = document.getElementById('node-' + sid);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    renderConns(); moved = true; drawMinimap();
  };
  const onEnd = () => {
    nodeEl.removeEventListener('touchmove', onMove);
    nodeEl.removeEventListener('touchend',  onEnd);
    if (moved) snapshot();
  };
  nodeEl.addEventListener('touchmove', onMove, { passive: false });
  nodeEl.addEventListener('touchend',  onEnd);
}

// ──────────────────────────────────────────────
// RESIZE
// ──────────────────────────────────────────────
function resizeMouseDown(e) {
  if (!canEdit()) return;
  e.stopPropagation(); e.preventDefault();
  const id = e.target.dataset.node;
  const n  = state.nodes[id];
  if (n.type === 'decision') return; // ひし形はリサイズ禁止
  const minW = 100, maxW = 280;
  const startX = e.clientX, startW = n.w;
  const onMove = e2 => {
    if (!canEdit()) return;
    n.w = Math.min(maxW, Math.max(minW, startW + (e2.clientX - startX) / state.zoom));
    const el = document.getElementById('node-' + id);
    if (el) el.style.width = n.w + 'px';
    renderConns();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    snapshot();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

// ──────────────────────────────────────────────
// CONNECTIONS
// ──────────────────────────────────────────────
function getPortPos(nodeId, port) {
  const n = state.nodes[nodeId];
  if (!n) return { x: 0, y: 0 };
  const ox = n.x, oy = n.y;

  // ひし形: CSS固定サイズ 165×82.5px
  if (n.type === 'decision') {
    const W = 165, H = 82.5;
    if (port === 'top')    return { x: ox + W / 2, y: oy };
    if (port === 'bottom') return { x: ox + W / 2, y: oy + H };
    if (port === 'left')   return { x: ox,          y: oy + H / 2 };
    if (port === 'right')  return { x: ox + W,      y: oy + H / 2 };
    return { x: ox + W / 2, y: oy + H / 2 };
  }

  const el      = document.getElementById('node-' + nodeId);
  const innerEl = el ? el.querySelector('.node-inner') : null;
  const h       = innerEl ? innerEl.offsetHeight : (el ? el.offsetHeight : 40);
  const w       = n.w;
  if (port === 'top')    return { x: ox + w / 2, y: oy };
  if (port === 'bottom') return { x: ox + w / 2, y: oy + h };
  if (port === 'left')   return { x: ox,          y: oy + h / 2 };
  if (port === 'right')  return { x: ox + w,      y: oy + h / 2 };
  return { x: ox + w / 2, y: oy + h / 2 };
}

function addConn(fromId, fromPort, toId, toPort, label) {
  if (!canEdit()) return;
  if (fromId === toId) return;
  const id = cid();
  state.conns[id] = { id, from: fromId, fromPort: fromPort || 'bottom', to: toId, toPort: toPort || 'top', label: label || '' };
  snapshot(); renderConn(id); updateStatus();
  return id;
}

function renderConns() {
  svgLayer.innerHTML = '';
  renderGroups();
  Object.keys(state.conns).forEach(id => renderConn(id));
  if (state.tempConn) drawTempConn(state.tempConn);
  applyViewHighlights();
}

const GROUP_COLORS = ['#5b9cf6','#a78bfa','#2dd4bf','#4ade80','#fbbf24','#f97316','#f87171'];

function createGroupFromSelection() {
  if (!canEdit()) return;
  const nodeIds = [...state.selected].filter(id => state.nodes[id]);
  if (nodeIds.length < 2) return notify('2個以上のノードを選択してください');
  const label = prompt('処理領域の名前:', '処理グループ');
  if (label === null) return;
  const id = gid();
  state.groups[id] = {
    id, label: label.trim().slice(0, 4096) || '処理グループ', nodeIds,
    color: GROUP_COLORS[Object.keys(state.groups).length % GROUP_COLORS.length],
    padding: 28, splitDistance: 150
  };
  snapshot(); renderConns(); updateRightPanel();
  notify('処理領域を作成しました');
}

function nodeBox(id, padding = 0) {
  const n = state.nodes[id]; if (!n) return null;
  const el = document.getElementById('node-' + id);
  const inner = el?.querySelector('.node-inner');
  const h = inner ? inner.offsetHeight : (el ? el.offsetHeight : 40);
  return { x:n.x-padding, y:n.y-padding, w:n.w+padding*2, h:h+padding*2 };
}
function boxGap(a, b) {
  const dx = Math.max(0, Math.max(a.x,b.x)-Math.min(a.x+a.w,b.x+b.w));
  const dy = Math.max(0, Math.max(a.y,b.y)-Math.min(a.y+a.h,b.y+b.h));
  return Math.hypot(dx,dy);
}
function groupIslands(group) {
  const items = group.nodeIds.map(id=>({id,box:nodeBox(id,group.padding??28)})).filter(x=>x.box);
  const unseen = new Set(items.map(x=>x.id));
  const byId = Object.fromEntries(items.map(x=>[x.id,x.box])), islands=[];
  while (unseen.size) {
    const seed=unseen.values().next().value; unseen.delete(seed);
    const island=[seed], queue=[seed];
    while(queue.length) {
      const current=queue.shift();
      [...unseen].forEach(other=>{
        if(boxGap(byId[current],byId[other]) <= (group.splitDistance??150)) {
          unseen.delete(other); island.push(other); queue.push(other);
        }
      });
    }
    islands.push(island.map(id=>byId[id]));
  }
  return islands;
}
function convexHull(points) {
  if(points.length<=2) return points;
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[]; sorted.forEach(p=>{while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);});
  const upper=[]; [...sorted].reverse().forEach(p=>{while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);});
  lower.pop(); upper.pop(); return lower.concat(upper);
}
function organicPath(boxes) {
  const points=[];
  boxes.forEach(b=>{
    const r=Math.min(18,b.w/5,b.h/4);
    points.push({x:b.x+r,y:b.y},{x:b.x+b.w-r,y:b.y},{x:b.x+b.w,y:b.y+r},{x:b.x+b.w,y:b.y+b.h-r},{x:b.x+b.w-r,y:b.y+b.h},{x:b.x+r,y:b.y+b.h},{x:b.x,y:b.y+b.h-r},{x:b.x,y:b.y+r});
  });
  const hull=convexHull(points); if(!hull.length)return '';
  const mids=hull.map((p,i)=>({x:(p.x+hull[(i+1)%hull.length].x)/2,y:(p.y+hull[(i+1)%hull.length].y)/2}));
  let d=`M ${mids.at(-1).x} ${mids.at(-1).y}`;
  hull.forEach((p,i)=>{d+=` Q ${p.x} ${p.y} ${mids[i].x} ${mids[i].y}`;});
  return d+' Z';
}
function renderGroups() {
  Object.values(state.groups).forEach(group=>{
    const groupColor = group.color || '#5b9cf6';
    groupIslands(group).forEach((boxes,islandIndex)=>{
      const pathData=organicPath(boxes); if(!pathData)return;
      const g=document.createElementNS('http://www.w3.org/2000/svg','g');
      g.classList.add('process-region'); g.dataset.groupId=group.id;
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',pathData); path.setAttribute('fill',groupColor); path.setAttribute('fill-opacity','0.094');
      path.setAttribute('stroke',groupColor); path.setAttribute('stroke-opacity','0.55');
      path.setAttribute('stroke-width','1.5'); path.setAttribute('stroke-dasharray','7 5');
      g.appendChild(path);
      const top=boxes.reduce((best,b)=>b.y<best.y?b:best,boxes[0]);
      const text=document.createElementNS('http://www.w3.org/2000/svg','text');
      text.classList.add('process-region-label'); text.setAttribute('x',top.x+10); text.setAttribute('y',top.y-8);
      text.setAttribute('fill',groupColor); text.textContent=islandIndex?`${group.label} · ${islandIndex+1}`:group.label;
      g.appendChild(text); svgLayer.appendChild(g);
    });
  });
}

function ensureDefs() {
  if (!svgLayer.querySelector('defs')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
    svgLayer.insertBefore(defs, svgLayer.firstChild);
  }
}

function renderConn(id) {
  const c = state.conns[id];
  if (!c) return;
  const from = getPortPos(c.from, c.fromPort);
  const to   = getPortPos(c.to,   c.toPort);
  const path = bezierPath(from, to, c.fromPort, c.toPort, c);
  const g    = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.dataset.connId = id;
  const semantic = FlowDraftData.getSemantic(state, id);
  const appearance = FlowDraftData.semanticStyle(semantic);
  g.dataset.kind = semantic.kind;
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = [c.label, appearance.label, semantic.description].filter(Boolean).join(' · ');
  g.appendChild(title);

  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('d', path); hit.setAttribute('fill', 'none');
  hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '12');
  hit.style.cursor = 'pointer'; hit.style.pointerEvents = 'all';
  hit.addEventListener('click',       e => { e.stopPropagation(); selectConn(id); });
  hit.addEventListener('contextmenu', e => { e.preventDefault(); showConnCtxMenu(e, id); });

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path); line.setAttribute('fill', 'none');
  line.classList.add('conn-line');
  line.setAttribute('stroke', state.selected.has('conn-' + id) ? '#4f8df5' : (appearance.color || 'var(--conn, #7c8799)'));
  if (appearance.dash) line.setAttribute('stroke-dasharray', appearance.dash);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('marker-end', 'url(#arrow)');

  g.appendChild(hit); g.appendChild(line);

  const displayLabel = c.label || (semantic.kind !== 'unspecified' || semantic.outcome !== 'unspecified' ? appearance.label : '');
  if (displayLabel) {
    const mid = bezierMidpoint(from, to, c.fromPort, c.toPort, c);
    const labelW = 160, labelH = 24;
    const fo  = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', mid.x - labelW / 2); fo.setAttribute('y', mid.y - labelH / 2);
    fo.setAttribute('width', labelW);  fo.setAttribute('height', labelH);
    fo.style.overflow = 'visible'; fo.style.pointerEvents = 'all';
    const div = document.createElement('div');
    div.className = 'conn-label';
    div.style.cssText = 'position:static;transform:none;text-align:center;width:fit-content;max-width:160px;margin:0 auto;';
    div.textContent = displayLabel;
    div.addEventListener('click', e => { e.stopPropagation(); selectConn(id); });
    div.title = 'ドラッグして線の曲がり方を調整';
    div.addEventListener('pointerdown', e => startConnLabelDrag(e, id, mid));
    div.addEventListener('dblclick', () => {
      if (!canEdit()) return;
      const nl = prompt('ラベル:', c.label);
      if (nl !== null) { c.label = nl.slice(0, 4096); snapshot(); renderConns(); }
    });
    fo.appendChild(div); g.appendChild(fo);
  }

  ensureDefs();
  svgLayer.appendChild(g);
}

function removeConnEl(id) {
  const el = svgLayer.querySelector(`[data-conn-id="${id}"]`);
  if (el) el.remove();
}

function selectConn(id) {
  if (!canEdit()) { focusViewConnection(id); return; }
  state.selected.clear();
  state.selected.add('conn-' + id);
  updateRightPanel();
}

function portDirection(port) {
  if (port === 'top')    return { x: 0,  y: -1 };
  if (port === 'bottom') return { x: 0,  y: 1 };
  if (port === 'left')   return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function bezierGeometry(from, to, fp, tp, conn = null) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  // 固定60pxだと近いノード間で制御点が交差するため、距離に比例させる
  const tangent = Math.max(16, Math.min(96, distance * 0.24));
  const fromDir = portDirection(fp);
  const toDir   = portDirection(tp);
  let c1x = from.x, c1y = from.y, c2x = to.x, c2y = to.y;
  c1x += fromDir.x * tangent;
  c1y += fromDir.y * tangent;
  // 終点側の制御点は、ポートから外向き方向へ置く
  c2x += toDir.x * tangent;
  c2y += toDir.y * tangent;

  const defaultMid = {
    x: 0.125 * from.x + 0.375 * c1x + 0.375 * c2x + 0.125 * to.x,
    y: 0.125 * from.y + 0.375 * c1y + 0.375 * c2y + 0.125 * to.y,
  };

  if (Number.isFinite(conn?.bendX) && Number.isFinite(conn?.bendY)) {
    // 2つの制御点を同量動かすと、中点はその75%だけ動く
    const adjustX = (conn.bendX - defaultMid.x) * 4 / 3;
    const adjustY = (conn.bendY - defaultMid.y) * 4 / 3;
    c1x += adjustX; c1y += adjustY;
    c2x += adjustX; c2y += adjustY;
  }

  return {
    c1x, c1y, c2x, c2y,
    mid: {
      x: 0.125 * from.x + 0.375 * c1x + 0.375 * c2x + 0.125 * to.x,
      y: 0.125 * from.y + 0.375 * c1y + 0.375 * c2y + 0.125 * to.y,
    },
  };
}

function bezierPath(from, to, fp, tp, conn = null) {
  const { c1x, c1y, c2x, c2y } = bezierGeometry(from, to, fp, tp, conn);
  return `M ${from.x} ${from.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y}`;
}

function bezierMidpoint(from, to, fp, tp, conn = null) {
  return bezierGeometry(from, to, fp, tp, conn).mid;
}

function startConnLabelDrag(e, id, startMid) {
  if (!canEdit()) return;
  if (e.button !== undefined && e.button !== 0) return;
  const c = state.conns[id];
  if (!c) return;
  e.preventDefault();
  e.stopPropagation();

  const startCanvas = clientToCanvas(e);
  const startWorld  = canvasToWorld(startCanvas.x, startCanvas.y);
  const offsetX = startMid.x - startWorld.x;
  const offsetY = startMid.y - startWorld.y;
  let moved = false;

  const onMove = e2 => {
    if (!canEdit()) return;
    const cp = clientToCanvas(e2);
    const w  = canvasToWorld(cp.x, cp.y);
    c.bendX = w.x + offsetX;
    c.bendY = w.y + offsetY;
    moved = true;
    renderConns();
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    if (moved) snapshot();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function drawTempConn(tc) {
  ensureDefs();
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', tc.x1); line.setAttribute('y1', tc.y1);
  line.setAttribute('x2', tc.x2); line.setAttribute('y2', tc.y2);
  line.setAttribute('stroke', '#5b9cf6'); line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-dasharray', '5,3'); line.setAttribute('marker-end', 'url(#arrow)');
  svgLayer.appendChild(line);
}

// ──────────────────────────────────────────────
// SELECTION
// ──────────────────────────────────────────────
function renderSelection() {
  Object.keys(state.nodes).forEach(id => {
    const el = document.getElementById('node-' + id);
    if (el) el.classList.toggle('selected', state.selected.has(id));
  });
  const groupButton = document.getElementById('btn-group');
  if (groupButton) groupButton.disabled = [...state.selected].filter(id => state.nodes[id]).length < 2;
  renderConns();
}

// ──────────────────────────────────────────────
// PORT / CONNECT
// ──────────────────────────────────────────────
function portMouseDown(e) {
  if (!canEdit()) return;
  if (state.mode !== 'connect' && !e.altKey) return;
  e.stopPropagation(); e.preventDefault();
  const port = e.target.dataset.port, nodeId = e.target.dataset.node;
  canvasWrap.classList.add('mode-connect');
  state.connStart = { nodeId, port };
  const pos = getPortPos(nodeId, port);
  state.tempConn = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
  const onMove = e2 => {
    if (!canEdit() || !state.tempConn) return;
    const cp = clientToCanvas(e2), w = canvasToWorld(cp.x, cp.y);
    state.tempConn.x2 = w.x; state.tempConn.y2 = w.y;
    renderConns();
  };
  const onUp = e2 => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    state.tempConn = null;
    if (state.mode !== 'connect') canvasWrap.classList.remove('mode-connect');
    const target = document.elementFromPoint(e2.clientX, e2.clientY);
    if (target && target.classList.contains('port') && target.dataset.node !== nodeId) {
      addConn(nodeId, port, target.dataset.node, target.dataset.port);
    }
    renderConns();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function portTouchStart(e) {
  if (!canEdit()) return;
  e.stopPropagation(); e.preventDefault();
  const port = e.target.dataset.port, nodeId = e.target.dataset.node;
  canvasWrap.classList.add('mode-connect');
  state.connStart = { nodeId, port };
  const pos = getPortPos(nodeId, port);
  state.tempConn = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
  const onMove = e2 => {
    if (!canEdit() || !state.tempConn) return;
    e2.preventDefault();
    const cp = clientToCanvas(e2.touches[0]), w = canvasToWorld(cp.x, cp.y);
    state.tempConn.x2 = w.x; state.tempConn.y2 = w.y;
    renderConns();
  };
  const onEnd = e2 => {
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);
    state.tempConn = null;
    if (state.mode !== 'connect') canvasWrap.classList.remove('mode-connect');
    const t = e2.changedTouches[0];
    const target = findNearestPort(t.clientX, t.clientY, nodeId);
    if (target) addConn(nodeId, port, target.nodeId, target.port);
    renderConns();
  };
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend',  onEnd);
}

function findNearestPort(clientX, clientY, excludeNodeId) {
  const rect = canvasWrap.getBoundingClientRect();
  const wx   = (clientX - rect.left - state.panX) / state.zoom;
  const wy   = (clientY - rect.top  - state.panY) / state.zoom;
  let best = null, bestDist = Infinity;
  Object.values(state.nodes).forEach(n => {
    if (n.id === excludeNodeId) return;
    const el   = document.getElementById('node-' + n.id);
    const h    = el ? el.offsetHeight : 40;
    const unit = h / 2;
    const inBox = wx >= n.x - unit && wx <= n.x + n.w + unit &&
                  wy >= n.y - unit && wy <= n.y + h   + unit;
    if (!inBox) return;
    ['top', 'bottom', 'left', 'right'].forEach(p => {
      const pos = getPortPos(n.id, p);
      const d   = Math.hypot(pos.x - wx, pos.y - wy);
      if (d < bestDist) { bestDist = d; best = { nodeId: n.id, port: p }; }
    });
  });
  return best;
}

// ──────────────────────────────────────────────
// CANVAS PAN / ZOOM
// ──────────────────────────────────────────────
let panning = false, panStart = null;
const selBox = { active: false, start: null, isPanning: false };

canvasWrap.addEventListener('mousedown', e => {
  if (canEdit() && e.target !== canvasWrap && e.target !== canvas && e.target.id !== 'svg-layer') return;
  if (e.button !== 0) return;
  panning  = true;
  panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
  if (!canEdit()) return;
  e.preventDefault();
  const cp = clientToCanvas(e);
  selBox.start = cp; selBox.active = true; selBox.isPanning = false;
  const sb = document.getElementById('sel-box');
  sb.style.display = 'none';
  sb.style.left = cp.x + 'px'; sb.style.top = cp.y + 'px';
  sb.style.width = '0'; sb.style.height = '0';
  if (!e.shiftKey) { state.selected.clear(); renderSelection(); updateRightPanel(); }
});

canvasWrap.addEventListener('dblclick', e => {
  if (e.target !== canvasWrap && e.target !== canvas && e.target.id !== 'svg-layer') return;
  const cp = clientToCanvas(e), w = canvasToWorld(cp.x, cp.y);
  addNode('process', w.x - 70, w.y - 20);
});

document.addEventListener('mousemove', e => {
  if (panning) {
    state.panX = e.clientX - panStart.x;
    state.panY = e.clientY - panStart.y;
    applyTransform(); drawMinimap();
    if (selBox.active) { selBox.isPanning = true; document.getElementById('sel-box').style.display = 'none'; }
  }
  if (selBox.active && !selBox.isPanning) {
    const cp = clientToCanvas(e);
    const dx = Math.abs(cp.x - selBox.start.x), dy = Math.abs(cp.y - selBox.start.y);
    if (dx > 6 || dy > 6) {
      const x = Math.min(cp.x, selBox.start.x), y = Math.min(cp.y, selBox.start.y);
      const w = Math.abs(cp.x - selBox.start.x), h = Math.abs(cp.y - selBox.start.y);
      const sb = document.getElementById('sel-box');
      sb.style.display = 'block';
      sb.style.left = x + 'px'; sb.style.top = y + 'px';
      sb.style.width = w + 'px'; sb.style.height = h + 'px';
    }
  }
});

document.addEventListener('mouseup', e => {
  panning = false;
  if (selBox.active) {
    selBox.active = false;
    document.getElementById('sel-box').style.display = 'none';
    const cp = clientToCanvas(e);
    const x1 = Math.min(cp.x, selBox.start.x), y1 = Math.min(cp.y, selBox.start.y);
    const x2 = Math.max(cp.x, selBox.start.x), y2 = Math.max(cp.y, selBox.start.y);
    if (Math.abs(x2 - x1) > 4 || Math.abs(y2 - y1) > 4) {
      Object.values(state.nodes).forEach(n => {
        const el  = document.getElementById('node-' + n.id);
        const h   = el ? el.offsetHeight : 40;
        const nx1 = n.x * state.zoom + state.panX, ny1 = n.y * state.zoom + state.panY;
        const nx2 = nx1 + n.w * state.zoom,        ny2 = ny1 + h * state.zoom;
        if (nx1 < x2 && nx2 > x1 && ny1 < y2 && ny2 > y1) state.selected.add(n.id);
      });
      renderSelection(); updateRightPanel();
    }
  }
});

let touchPanStart = null, singleTouchPan = null;
canvasWrap.addEventListener('touchstart', e => {
  if (e.touches.length === 1 &&
      (!canEdit() || e.target === canvasWrap || e.target === canvas || e.target.id === 'svg-layer')) {
    const t = e.touches[0];
    singleTouchPan = { x: t.clientX - state.panX, y: t.clientY - state.panY };
  }
  if (e.touches.length === 2) {
    touchPanStart = {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - state.panX,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - state.panY,
      dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
      zoom: state.zoom,
    };
  }
}, { passive: true });

canvasWrap.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && singleTouchPan) {
    e.preventDefault();
    const t = e.touches[0];
    state.panX = t.clientX - singleTouchPan.x;
    state.panY = t.clientY - singleTouchPan.y;
    applyTransform(); drawMinimap();
  }
  if (e.touches.length === 2 && touchPanStart) {
    e.preventDefault();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    state.panX = cx - touchPanStart.x;
    state.panY = cy - touchPanStart.y;
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    state.zoom = Math.max(0.2, Math.min(3, touchPanStart.zoom * (dist / touchPanStart.dist)));
    applyTransform(); drawMinimap(); updateZoomLabel();
  }
}, { passive: false });

canvasWrap.addEventListener('touchend', () => {
  singleTouchPan = null; touchPanStart = null;
}, { passive: true });

canvasWrap.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const cp = clientToCanvas(e);
    const wx = (cp.x - state.panX) / state.zoom, wy = (cp.y - state.panY) / state.zoom;
    state.zoom = Math.max(0.2, Math.min(3, state.zoom * delta));
    state.panX = cp.x - wx * state.zoom; state.panY = cp.y - wy * state.zoom;
  } else if (e.shiftKey) {
    state.panX -= e.deltaY;
  } else {
    state.panX -= e.deltaX; state.panY -= e.deltaY;
  }
  applyTransform(); drawMinimap(); updateZoomLabel();
}, { passive: false });

canvasWrap.addEventListener('dragover', e => e.preventDefault());
canvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  const type = e.dataTransfer.getData('nodeType');
  if (!type) return;
  const cp = clientToCanvas(e), w = canvasToWorld(cp.x, cp.y);
  addNode(type, w.x - 60, w.y - 20);
});

function applyTransform() {
  canvas.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;
}
function updateZoomLabel() {
  document.getElementById('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
}

// ──────────────────────────────────────────────
// MODE
// ──────────────────────────────────────────────
function setMode(m) {
  if (!canEdit()) return;
  state.mode = m;
  document.getElementById('btn-conn')?.classList.toggle('active',   m === 'connect');
  document.getElementById('btn-select')?.classList.toggle('active', m === 'select');
  canvasWrap.classList.toggle('mode-connect', m === 'connect');
  const stMode = document.getElementById('st-mode');
  if (stMode) stMode.textContent = m === 'connect' ? '接続' : (m === 'group' ? '領域選択' : '選択');
  // モバイル接続ボタンのハイライト同期
  const mConn = document.getElementById('m-connect');
  if (mConn) mConn.classList.toggle('connect-active', m === 'connect');
  const groupToolbar = document.getElementById('mobile-group-toolbar');
  if (groupToolbar) groupToolbar.hidden = m !== 'group';
}

function updateMobileGroupToolbar() {
  const count = [...state.selected].filter(id => state.nodes[id]).length;
  const label = document.getElementById('mobile-group-count');
  const create = document.getElementById('mobile-group-create');
  if (label) label.textContent = `${count}個選択`;
  if (create) create.disabled = count < 2;
}

function startMobileGroupSelection() {
  if (!canEdit()) return;
  closeModal('modal-settings');
  state.selected.clear();
  setMode('group');
  renderSelection();
  updateRightPanel();
  updateMobileGroupToolbar();
  notify('まとめるノードをタップしてください');
}

function cancelMobileGroupSelection() {
  state.selected.clear();
  setMode('select');
  renderSelection();
  updateRightPanel();
}

function finishMobileGroupSelection() {
  if ([...state.selected].filter(id => state.nodes[id]).length < 2) return;
  createGroupFromSelection();
  state.selected.clear();
  setMode('select');
  renderSelection();
  updateRightPanel();
}

// ──────────────────────────────────────────────
// LABEL EDIT
// ──────────────────────────────────────────────
function startEditLabel(id) {
  if (!canEdit()) return;
  const n = state.nodes[id];
  const labelEl = document.getElementById('label-' + id);
  if (!labelEl) return;
  const ta = document.createElement('textarea');
  ta.className = 'node-label-input'; ta.value = n.label; ta.rows = 1;
  ta.maxLength = 4096;
  labelEl.replaceWith(ta);
  ta.focus(); ta.select();
  const finish = () => {
    if (!canEdit()) return;
    n.label = ta.value.trim() || n.label;
    snapshot(); renderNode(id); renderConns();
  };
  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    if (e.key === 'Escape') { ta.value = n.label; ta.blur(); }
    e.stopPropagation();
  });
}

// ──────────────────────────────────────────────
// RIGHT PANEL
// ──────────────────────────────────────────────
function updateRightPanel() {
  if (!canEdit()) { renderViewPanel(); return; }
  if (state.selected.size === 1) {
    const id = [...state.selected][0];
    openRightPanel();
    if (id.startsWith('conn-')) renderConnProps(id.replace('conn-', ''));
    else renderNodeProps(id);
  } else if (state.selected.size > 1) {
    openRightPanel();
    rightPanel.innerHTML = `<div class="prop-section">${panelHeader('選択中')}<div style="font-size:11px;color:var(--text2);margin-bottom:10px">${state.selected.size}個のノード</div><button class="modal-btn primary" id="panel-create-group" style="width:100%">処理領域にまとめる</button></div>`;
    bindPanelClose();
    document.getElementById('panel-create-group')?.addEventListener('click', createGroupFromSelection);
    renderGroupControls([...state.selected].filter(id => state.nodes[id]));
  } else {
    rightPanel.innerHTML = '';
  }
}

function renderGroupControls(nodeIds) {
  const groups = Object.values(state.groups).filter(group => group.nodeIds.some(id => nodeIds.includes(id)));
  if (!groups.length) return;
  const section = document.createElement('div');
  section.className = 'prop-section';
  section.innerHTML = '<div class="panel-label">処理領域</div>';
  groups.forEach(group => {
    const row = document.createElement('div');
    row.className = 'group-control';
    const label = document.createElement('span');
    label.className = 'group-control-label';
    label.style.setProperty('--group-color', group.color);
    label.textContent = group.label;
    const rename = document.createElement('button');
    rename.className = 'secondary-btn'; rename.textContent = '名称変更';
    rename.addEventListener('click', () => {
      const next = prompt('処理領域の名前:', group.label);
      if (next === null) return;
      group.label = next.trim().slice(0, 4096) || group.label;
      snapshot(); renderConns(); updateRightPanel();
    });
    const remove = document.createElement('button');
    remove.className = 'secondary-btn group-remove'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      delete state.groups[group.id];
      snapshot(); renderConns(); updateRightPanel(); notify('処理領域を解除しました');
    });
    row.append(label, rename, remove); section.appendChild(row);
  });
  rightPanel.appendChild(section);
}

function buildColorPalette(n, id) {
  const colors = state.theme === 'dark' ? COLORS_DARK : COLORS_LIGHT;
  const row    = rightPanel.querySelector('#color-palette-row');
  if (!row) return;
  row.innerHTML =
    `<div class="color-dot bg-dot${(n.bgColor || '') === '' ? ' active' : ''}" role="button" tabindex="0" aria-label="標準の背景色" style="background:var(--node-border);border:1px dashed var(--border2);" data-color=""></div>` +
    colors.map(c =>
      `<div class="color-dot bg-dot${(n.bgColor || '') === c ? ' active' : ''}" role="button" tabindex="0" aria-label="背景色 ${c}" style="background:${c}" data-color="${c}"></div>`
    ).join('') +
    `<input type="color" id="bg-color-picker" value="${n.bgColor || '#ffffff'}" aria-label="カスタム背景色" style="width:18px;height:18px;border-radius:50%;border:2px solid transparent;padding:0;cursor:pointer;background:transparent;" title="カスタム">`;
  row.querySelectorAll('.bg-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      n.bgColor = dot.dataset.color;
      snapshot(); renderNode(id); buildColorPalette(n, id);
    });
    dot.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dot.click(); }
    });
  });
  const picker = row.querySelector('#bg-color-picker');
  if (picker) {
    picker.addEventListener('input',  e => { n.bgColor = e.target.value; renderNode(id); });
    picker.addEventListener('change', ()  => snapshot());
  }
}

function renderNodeProps(id) {
  const n = state.nodes[id];
  if (!n) return;
  rightPanel.innerHTML = `
    <div class="prop-section">
      ${panelHeader('プロパティ')}
      <div class="prop-row">
        <div class="prop-label">ラベル</div>
        <textarea class="prop-input" id="prop-label" rows="2" maxlength="4096" aria-label="ラベル">${escHtml(n.label)}</textarea>
      </div>
      <div class="prop-row">
        <div class="prop-label">サブテキスト</div>
        <textarea class="prop-input" id="prop-sub" rows="1" maxlength="4096" aria-label="サブテキスト" style="overflow:hidden;field-sizing:content;min-height:28px">${escHtml(n.sublabel)}</textarea>
      </div>
      <div class="prop-row">
        <div class="prop-label">ノードタイプ</div>
        <select class="prop-select" id="prop-type" aria-label="ノードタイプ">
          ${NODE_TYPES.map(t => `<option value="${t.type}"${t.type === n.type ? ' selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="prop-row">
        <div class="prop-label">背景カラー</div>
        <div class="color-row" id="color-palette-row"></div>
      </div>
    </div>
    <div class="prop-section">
      <button class="del-btn" id="prop-del">ノードを削除</button>
    </div>`;
  bindPanelClose();
  buildColorPalette(n, id);
  document.getElementById('prop-label').addEventListener('input', e => { n.label = e.target.value; renderNode(id); });
  document.getElementById('prop-label').addEventListener('change', () => snapshot());
  document.getElementById('prop-sub').addEventListener('input', e => {
    n.sublabel = e.target.value;
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
    renderNode(id);
  });
  document.getElementById('prop-sub').addEventListener('change', () => snapshot());
  document.getElementById('prop-type').addEventListener('change', e => {
    n.type = e.target.value; snapshot(); renderNode(id); renderConns();
  });
  document.getElementById('prop-del').addEventListener('click', () => removeNode(id));
}

function renderConnProps(id) {
  const c = state.conns[id];
  if (!c) return;
  rightPanel.innerHTML = `
    <div class="prop-section">
      ${panelHeader('接続')}
      <div class="prop-row">
        <div class="prop-label">ラベル</div>
        <input class="prop-input" id="conn-label" value="${escHtml(c.label)}" aria-label="接続ラベル" maxlength="4096">
      </div>
      <div class="prop-help">ラベルをドラッグすると線の曲がり方を調整できます。</div>
    </div>
    ${Number.isFinite(c.bendX) && Number.isFinite(c.bendY) ? `
    <div class="prop-section">
      <button class="secondary-btn" id="conn-reset-bend">曲がりを自動に戻す</button>
    </div>` : ''}
    <div class="prop-section">
      <button class="del-btn" id="conn-del">接続を削除</button>
    </div>`;
  bindPanelClose();
  appendSemanticEditor(id);
  document.getElementById('conn-label').addEventListener('change', e => { c.label = e.target.value; snapshot(); renderConns(); });
  document.getElementById('conn-reset-bend')?.addEventListener('click', () => {
    delete c.bendX;
    delete c.bendY;
    snapshot();
    renderConns();
    renderConnProps(id);
  });
  document.getElementById('conn-del').addEventListener('click', () => {
    removeConnEl(id); delete state.conns[id]; snapshot(); updateStatus(); renderConns();
    state.selected.clear(); updateRightPanel();
  });
}

// ──────────────────────────────────────────────
// CONTEXT MENU
// ──────────────────────────────────────────────
let ctxTarget = null;
function showCtxMenu(e, nodeId) {
  if (!canEdit()) return;
  ctxTarget = nodeId;
  const menu = document.getElementById('ctx-menu');
  menu.classList.add('open');
  menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
}
function showConnCtxMenu(e, connId) {
  if (!canEdit()) return;
  ctxTarget = 'conn-' + connId;
  const menu = document.getElementById('ctx-menu');
  menu.classList.add('open');
  menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
}
document.addEventListener('click', () => document.getElementById('ctx-menu').classList.remove('open'));
document.getElementById('ctx-edit').addEventListener('click', () => {
  if (ctxTarget && !ctxTarget.startsWith('conn-')) startEditLabel(ctxTarget);
});
document.getElementById('ctx-dup').addEventListener('click', () => {
  if (!ctxTarget || ctxTarget.startsWith('conn-')) return;
  const n = state.nodes[ctxTarget];
  addNode(n.type, n.x + 20, n.y + 20, n.label, n.sublabel, n.color);
});
document.getElementById('ctx-del').addEventListener('click', () => {
  if (!canEdit()) return;
  if (!ctxTarget) return;
  if (ctxTarget.startsWith('conn-')) {
    const id = ctxTarget.replace('conn-', '');
    removeConnEl(id); delete state.conns[id]; snapshot(); updateStatus(); renderConns();
  } else { removeNode(ctxTarget); }
});

// ──────────────────────────────────────────────
// FIT VIEW
// ──────────────────────────────────────────────
function fitView() {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const el = document.getElementById('node-' + n.id);
    const h  = el ? el.offsetHeight : 40;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + h);
  });
  const pad        = 60;
  const vw         = canvasWrap.clientWidth;
  const vh         = canvasWrap.clientHeight;
  const safeOffset = isMobile() ? 120 : 0;
  const effectiveH = vh - safeOffset;
  const zx = (vw          - pad * 2) / (maxX - minX || 1);
  const zy = (effectiveH  - pad * 2) / (maxY - minY || 1);
  // 小さい図を必要以上に拡大せず、全体像を安定して見せる
  state.zoom = Math.max(0.2, Math.min(1, Math.min(zx, zy)));
  state.panX = (vw         - (maxX - minX) * state.zoom) / 2 - minX * state.zoom;
  state.panY = (effectiveH - (maxY - minY) * state.zoom) / 2 - minY * state.zoom;
  applyTransform(); updateZoomLabel(); drawMinimap();
}

// ──────────────────────────────────────────────
// MINIMAP
// ──────────────────────────────────────────────
function drawMinimap() {
  const mc = document.getElementById('minimap-canvas');
  if (!mc) return;
  const ctx   = mc.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const getVar = v => style.getPropertyValue(v).trim();
  const mw = 140, mh = 90;
  mc.width = mw; mc.height = mh;
  ctx.clearRect(0, 0, mw, mh);
  const nodes = Object.values(state.nodes);
  if (!nodes.length) return;
  const pad = 10;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const el = document.getElementById('node-' + n.id);
    const h  = el ? el.offsetHeight : 40;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + h);
  });
  const sw    = maxX - minX || 100, sh = maxY - minY || 100;
  const scale = Math.min((mw - pad * 2) / sw, (mh - pad * 2) / sh);
  const ox    = (mw - sw * scale) / 2 - minX * scale;
  const oy    = (mh - sh * scale) / 2 - minY * scale;
  nodes.forEach(n => {
    const el = document.getElementById('node-' + n.id);
    const h  = el ? el.offsetHeight : 40;
    ctx.fillStyle = state.selected.has(n.id)
      ? getVar('--node-sel')
      : (getVar(`--node-${n.type}-bg`) || getVar('--node-bg'));
    ctx.globalAlpha = 0.85;
    ctx.fillRect(n.x * scale + ox, n.y * scale + oy, n.w * scale, h * scale);
    ctx.globalAlpha = 1;
  });
  ctx.strokeStyle = getVar('--conn'); ctx.lineWidth = 0.5;
  Object.values(state.conns).forEach(c => {
    const f = getPortPos(c.from, c.fromPort), t = getPortPos(c.to, c.toPort);
    ctx.beginPath();
    ctx.moveTo(f.x * scale + ox, f.y * scale + oy);
    ctx.lineTo(t.x * scale + ox, t.y * scale + oy);
    ctx.stroke();
  });
  const vw  = canvasWrap.clientWidth, vh = canvasWrap.clientHeight;
  const vx  = (-state.panX / state.zoom) * scale + ox;
  const vy  = (-state.panY / state.zoom) * scale + oy;
  const vw2 = (vw / state.zoom) * scale, vh2 = (vh / state.zoom) * scale;
  const vp  = document.getElementById('minimap-viewport');
  vp.style.left = Math.max(0, vx) + 'px'; vp.style.top    = Math.max(0, vy) + 'px';
  vp.style.width = vw2 + 'px';            vp.style.height = vh2 + 'px';
}

document.getElementById('minimap').addEventListener('click', e => {
  const mc   = document.getElementById('minimap-canvas');
  const rect = mc.getBoundingClientRect();
  const mx   = (e.clientX - rect.left) / rect.width;
  const my   = (e.clientY - rect.top)  / rect.height;
  const nodes = Object.values(state.nodes);
  if (!nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const el = document.getElementById('node-' + n.id); const h = el ? el.offsetHeight : 40;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + h);
  });
  const wx = minX + mx * (maxX - minX), wy = minY + my * (maxY - minY);
  state.panX = canvasWrap.clientWidth  / 2 - wx * state.zoom;
  state.panY = canvasWrap.clientHeight / 2 - wy * state.zoom;
  applyTransform(); drawMinimap();
});

// ──────────────────────────────────────────────
// STATUS
// ──────────────────────────────────────────────
function updateStatus() {
  document.getElementById('st-nodes').textContent = Object.keys(state.nodes).length;
  document.getElementById('st-conns').textContent = Object.keys(state.conns).length;
}

// ──────────────────────────────────────────────
// SHARE URL
// ──────────────────────────────────────────────
function generateShareUrl() {
  const data = getDocument();
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  return window.location.href.split(/[?#]/)[0] + '?d=' + encodeURIComponent(encoded);
}
function loadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const d = params.get('d');
  if (!d) return false;
  try {
    if (d.length > 7000000) throw new Error('共有URLが大きすぎます');
    const data = JSON.parse(decodeURIComponent(escape(atob(d.replace(/ /g, '+')))));
    applyDocument(data);
    return true;
  } catch(e) { notify('共有URLを読み込めませんでした。保存データを確認します。'); return false; }
}

document.getElementById('btn-share').addEventListener('click', () => {
  document.getElementById('share-url-text').textContent = generateShareUrl();
  openModal('modal-share');
});
document.getElementById('share-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('share-url-text').textContent)
    .then(() => { notify('URLをコピーしました'); closeModal('modal-share'); });
});

// ──────────────────────────────────────────────
// TEMPLATES
// ──────────────────────────────────────────────
const TEMPLATES = [
  {
    name: 'API リクエスト', desc: 'REST APIフロー',
    build: () => {
      const s = addNode('start', 100, 40, 'クライアント');
      const a = addNode('api', 100, 130, 'API Gateway', 'ルーティング');
      const auth = addNode('decision', 100, 230, '認証OK?');
      const svc = addNode('process', 40, 340, 'Service Layer');
      const err = addNode('end', 220, 340, '401 Error');
      const db  = addNode('db', 40, 440, 'Database', 'PostgreSQL');
      const res = addNode('end', 40, 540, 'Response');
      addConn(s,'bottom',a,'top'); addConn(a,'bottom',auth,'top');
      addConn(auth,'left',svc,'top','Yes'); addConn(auth,'right',err,'top','No');
      addConn(svc,'bottom',db,'top'); addConn(db,'bottom',res,'top');
    }
  },
  {
    name: 'CI/CD パイプライン', desc: 'ビルド〜デプロイ',
    build: () => {
      const push  = addNode('start',   100,  40, 'git push');
      const build = addNode('process', 100, 140, 'Build', 'Docker image');
      const test  = addNode('process', 100, 240, 'Test', 'unit / e2e');
      const ok    = addNode('decision',100, 340, 'テスト通過?');
      const stage = addNode('process',  40, 450, 'Staging Deploy');
      const fail  = addNode('end',     220, 450, 'Fail / Notify');
      const prod  = addNode('process',  40, 560, 'Production', 'Blue/Green');
      addConn(push,'bottom',build,'top'); addConn(build,'bottom',test,'top');
      addConn(test,'bottom',ok,'top');
      addConn(ok,'left',stage,'top','Pass'); addConn(ok,'right',fail,'top','Fail');
      addConn(stage,'bottom',prod,'top');
    }
  },
  {
    name: 'ユーザー認証', desc: 'ログインフロー',
    build: () => {
      const s      = addNode('start',    100,  40, 'ログイン画面');
      const inp    = addNode('io',       100, 130, 'ID / パスワード入力');
      const val    = addNode('decision', 100, 230, '入力バリデーション');
      const auth   = addNode('process',   40, 340, 'DB照合');
      const errv   = addNode('end',      220, 310, 'エラー表示');
      const mfa    = addNode('decision',  40, 440, 'MFA有効?');
      const mfainp = addNode('io',        40, 540, 'MFAコード入力');
      const dash   = addNode('end',       40, 640, 'ダッシュボード');
      addConn(s,'bottom',inp,'top'); addConn(inp,'bottom',val,'top');
      addConn(val,'left',auth,'top','Valid'); addConn(val,'right',errv,'top','Invalid');
      addConn(auth,'bottom',mfa,'top');
      addConn(mfa,'bottom',mfainp,'top','Yes'); addConn(mfa,'right',dash,'left','No');
      addConn(mfainp,'bottom',dash,'top');
    }
  },
  {
    name: 'マイクロサービス', desc: 'サービス間通信',
    build: () => {
      const gw  = addNode('api',     100,  40, 'API Gateway');
      const q   = addNode('db',      100, 150, 'Message Queue', 'Kafka');
      const a   = addNode('process',  20, 270, 'Service A', 'Order');
      const b   = addNode('process', 160, 270, 'Service B', 'Payment');
      const da  = addNode('db',       20, 390, 'DB A');
      const db2 = addNode('db',      160, 390, 'DB B');
      addConn(gw,'bottom',q,'top');
      addConn(q,'bottom',a,'top'); addConn(q,'bottom',b,'top');
      addConn(a,'bottom',da,'top'); addConn(b,'bottom',db2,'top');
    }
  },
];

function buildTplGrid() {
  const grid = document.getElementById('tpl-grid');
  grid.innerHTML = '';
  TEMPLATES.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tpl-item';
    el.innerHTML = `<div class="tpl-name">${t.name}</div><div class="tpl-desc">${t.desc}</div>`;
    el.addEventListener('click', () => {
      if (!canEdit()) return;
      state.saveBlocked = false;
      snapshot(); // 適用前を履歴に保存
      Object.keys(state.nodes).forEach(id => { const el = document.getElementById('node-' + id); if (el) el.remove(); });
      Object.keys(state.conns).forEach(id => removeConnEl(id));
      state.nodes = {}; state.conns = {}; state.groups = {}; state.semantics = { connections: {} }; state.selected.clear();
      svgLayer.innerHTML = ''; state.nextId = 1;
      setDiagramName(t.name);
      const origSnap = window.snapshot; window.snapshot = () => {};
      t.build();
      window.snapshot = origSnap;
      snapshot(); renderAll();
      setTimeout(fitView, 100);
      closeModal('modal-tpl');
      notify(`${t.name} を適用しました`);
    });
    grid.appendChild(el);
  });
}

document.getElementById('btn-tpl').addEventListener('click', () => { buildTplGrid(); openModal('modal-tpl'); });

// NEW
document.getElementById('btn-new').addEventListener('click', () => openModal('modal-new'));
document.getElementById('confirm-new').addEventListener('click', () => {
  if (!canEdit()) return;
  state.saveBlocked = false;
  Object.keys(state.nodes).forEach(id => { const el = document.getElementById('node-' + id); if (el) el.remove(); });
  state.nodes = {}; state.conns = {}; state.groups = {}; state.semantics = { connections: {} }; state.selected.clear(); svgLayer.innerHTML = '';
  state.nextId = 1;
  setDiagramName('無題のフロー');
  applyCanvasBg('', '', false);
  snapshot(); updateStatus(); drawMinimap();
  closeModal('modal-new');
});

// UNDO/REDO
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

// CONN / SELECT
document.getElementById('btn-conn').addEventListener('click',   () => setMode('connect'));
document.getElementById('btn-select').addEventListener('click', () => setMode('select'));
document.getElementById('btn-group').addEventListener('click', createGroupFromSelection);

// FIT / ZOOM
document.getElementById('btn-fit').addEventListener('click', fitView);
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  const cx = canvasWrap.clientWidth / 2, cy = canvasWrap.clientHeight / 2;
  const wx = (cx - state.panX) / state.zoom, wy = (cy - state.panY) / state.zoom;
  state.zoom = Math.min(3, state.zoom * 1.2);
  state.panX = cx - wx * state.zoom; state.panY = cy - wy * state.zoom;
  applyTransform(); updateZoomLabel(); drawMinimap();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  const cx = canvasWrap.clientWidth / 2, cy = canvasWrap.clientHeight / 2;
  const wx = (cx - state.panX) / state.zoom, wy = (cy - state.panY) / state.zoom;
  state.zoom = Math.max(0.2, state.zoom / 1.2);
  state.panX = cx - wx * state.zoom; state.panY = cy - wy * state.zoom;
  applyTransform(); updateZoomLabel(); drawMinimap();
});

// THEME
document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);

// modal overlay close
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

// アイコンだけの操作とダイアログにも、読み上げ可能な名前と状態を付ける
document.querySelectorAll('button[data-tip], button[title]').forEach(button => {
  if (!button.hasAttribute('aria-label')) {
    button.setAttribute('aria-label', button.dataset.tip || button.title);
  }
});
document.querySelectorAll('.modal-overlay, #mobile-node-menu').forEach(layer => {
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-hidden', 'true');
  const title = layer.querySelector('h3');
  if (title) {
    title.id = `${layer.id}-title`;
    layer.setAttribute('aria-labelledby', title.id);
  }
});
notif.setAttribute('role', 'status');
notif.setAttribute('aria-live', 'polite');

// ──────────────────────────────────────────────
// KEYBOARD
// ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const openLayer = [...document.querySelectorAll('.modal-overlay.open, #mobile-node-menu.open')].pop();
    if (openLayer) {
      e.preventDefault();
      closeModal(openLayer.id);
      return;
    }
  }
  if (!canEdit()) {
    if (e.target.matches('input, textarea, select, button')) return;
    if (e.key === 'Escape') clearViewFocus();
    if (e.key.toLowerCase() === 'f') fitView();
    if (['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || ((e.ctrlKey || e.metaKey) && ['z', 'y', 'a'].includes(e.key.toLowerCase()))) e.preventDefault();
    return;
  }
  if (e.altKey) canvasWrap.classList.add('mode-connect');
  if (document.activeElement.matches('input, textarea, select')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const toDelete = [...state.selected];
    toDelete.forEach(id => {
      if (id.startsWith('conn-')) {
        const cid = id.replace('conn-', '');
        removeConnEl(cid); delete state.conns[cid];
      } else { removeNode(id); }
    });
    snapshot(); updateStatus(); renderConns();
    state.selected.clear(); updateRightPanel();
  }
  // C: 既に接続モードなら何もしない
  if ((e.key === 'c' || e.key === 'C') && state.mode !== 'connect') setMode('connect');
  if (e.key === 'v' || e.key === 'V' || e.key === 'Escape') setMode('select');
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    Object.keys(state.nodes).forEach(id => state.selected.add(id));
    renderSelection(); updateRightPanel();
  }
  if (e.key === 'f' || e.key === 'F') fitView();
  const arr = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
  if (arr[e.key] && state.selected.size) {
    e.preventDefault();
    const [dx, dy] = arr[e.key];
    state.selected.forEach(id => {
      if (!id.startsWith('conn-') && state.nodes[id]) {
        state.nodes[id].x += dx; state.nodes[id].y += dy;
        const el = document.getElementById('node-' + id);
        if (el) { el.style.left = state.nodes[id].x + 'px'; el.style.top = state.nodes[id].y + 'px'; }
      }
    });
    renderConns(); drawMinimap();
  }
});
document.addEventListener('keyup', e => {
  if (e.key === 'Alt' && state.mode !== 'connect') canvasWrap.classList.remove('mode-connect');
});

// ──────────────────────────────────────────────
// MOBILE UI
// ──────────────────────────────────────────────
function applyResponsiveUI() { document.body.classList.toggle('mobile', isMobile()); }
window.addEventListener('resize',            applyResponsiveUI);
window.addEventListener('orientationchange', applyResponsiveUI);
applyResponsiveUI();

const mAdd      = document.getElementById('m-add');
const mConnect  = document.getElementById('m-connect');
const mFit      = document.getElementById('m-fit');
const mReset    = document.getElementById('m-reset');
const mExport   = document.getElementById('m-export');
const mUndo     = document.getElementById('m-undo');
const mSettings = document.getElementById('m-settings');

function resetViewport() {
  state.zoom = 1;
  state.panX = canvasWrap.clientWidth / 2 - 200;
  state.panY = 40;
  applyTransform(); updateZoomLabel(); drawMinimap();
  notify('初期位置に戻しました');
}

if (mAdd) {
  mAdd.addEventListener('click', () => openLeftPanel());
}

document.getElementById('mobile-node-grid')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-type]');
  if (!btn) return;
  const centerX = (-state.panX + canvasWrap.clientWidth  / 2) / state.zoom;
  const centerY = (-state.panY + canvasWrap.clientHeight / 2) / state.zoom;
  addNode(btn.dataset.type, centerX - 70, centerY - 20);
  closeModal('mobile-node-menu');
  notify(`${NODE_TYPES.find(t => t.type === btn.dataset.type)?.label}を追加`);
});

if (mConnect) {
  mConnect.addEventListener('click', () => {
    const next = state.mode === 'connect' ? 'select' : 'connect';
    setMode(next); // setMode内でconnect-activeクラスも同期される
    notify(next === 'connect' ? '接続モード' : '選択モード');
  });
}

if (mExport)  { mExport.addEventListener('click',  () => openModal('modal-export')); }
if (mUndo)    { mUndo.addEventListener('click',    () => { undo(); notify('元に戻しました'); }); }
if (mFit)     { mFit.addEventListener('click',     () => { fitView(); notify('全体を表示'); }); }
if (mReset)   { mReset.addEventListener('click', resetViewport); }
if (mSettings) { mSettings.addEventListener('click', () => openModal('modal-settings')); }

document.getElementById('settings-theme')?.addEventListener('click', () => {
  toggleTheme(); closeModal('modal-settings');
  notify(state.theme === 'dark' ? 'ダークモード' : 'ライトモード');
});
document.getElementById('settings-canvas-bg')?.addEventListener('click', () => {
  closeModal('modal-settings');
  document.getElementById('btn-canvas-bg').click();
});
document.getElementById('settings-group')?.addEventListener('click', startMobileGroupSelection);
document.getElementById('mobile-group-cancel')?.addEventListener('click', cancelMobileGroupSelection);
document.getElementById('mobile-group-create')?.addEventListener('click', finishMobileGroupSelection);
document.getElementById('settings-share')?.addEventListener('click', () => {
  closeModal('modal-settings');
  document.getElementById('share-url-text').textContent = generateShareUrl();
  openModal('modal-share');
});
document.getElementById('settings-export')?.addEventListener('click', () => {
  closeModal('modal-settings');
  openModal('modal-export');
});
document.getElementById('settings-reset')?.addEventListener('click', () => {
  closeModal('modal-settings');
  resetViewport();
});
document.getElementById('settings-new')?.addEventListener('click', () => {
  closeModal('modal-settings'); openModal('modal-new');
});
document.getElementById('settings-tpl')?.addEventListener('click', () => {
  closeModal('modal-settings'); buildTplGrid(); openModal('modal-tpl');
});

// ──────────────────────────────────────────────
// INIT（DOMContentLoadedのみ、二重実行なし）
// ──────────────────────────────────────────────
function init() {
  buildPalette();
  applyTheme('light', { render: false, save: false }); // CSS変数を先に確立

  const fromUrl  = loadFromUrl();
  const fromSave = !fromUrl && loadSaved();

  if (!fromUrl && !fromSave) {
    applyCanvasBg('#f4f6fa', '#d7dee9', false);
    const s = addNode('start',   160,  60, '開始');
    const p = addNode('process', 140, 160, 'プロセス', 'ダブルクリックで編集');
    const e = addNode('end',     160, 280, '終了');
    addConn(s, 'bottom', p, 'top');
    addConn(p, 'bottom', e, 'top');
  } else {
    renderAll();
    snapshot(); // ロード完了状態を履歴の起点に
  }

  setMode('select');
  state.panX = canvasWrap.clientWidth / 2 - 200;
  state.panY = 40;
  applyTransform();
  setTimeout(fitView, 200);
}

document.addEventListener('DOMContentLoaded', init);
