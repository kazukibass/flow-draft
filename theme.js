const THEMES = {
  dark: { bg: '#1a1c20', bg2: '#23252a', bg3: '#2b2e34', border: '#3b4048', border2: '#555b66', text: '#e8e8ea', text2: '#888890', text3: '#55555c', nodeBg: '#1a1a1d', nodeBorder: '#333338', conn: '#444450', shadow: '0 2px 12px rgba(0,0,0,0.5)',
     nodeStyles: { start: { bg: '#123312', border: '#1d781d', type: '#4a8a4a' }, end: { bg: '#3e1818', border: '#741515', type: '#8a4a4a' }, process: { bg: '#13133a', border: '#27277d', type: '#4a4a8a' }, decision: { bg: '#47360a', border: '#f5b014', type: '#c49a3a' }, db: { bg: '#0d131b', border: '#2e639b', type: '#006789' }, api: { bg: '#1b0e29', border: '#4e1c80', type: '#6a4a8a' }, io: { bg: '#0a2317', border: '#2a6748', type: '#3a7a5a' }, 'loop-start': { bg: '#0a1a29', border: '#1b538a', type: '#3b82f6' }, 'loop-end': { bg: '#301c0b', border: '#a95c09', type: '#f59e0b' } } },
  light: { bg: '#eef1f5', bg2: '#f7f8fa', bg3: '#e3e7ee', border: '#d7dbe3', border2: '#bcc4d1', text: '#1f2937', text2: '#5b6472', text3: '#8a94a6', nodeBg: '#ffffff', nodeBorder: '#cfd6e2', conn: '#7c8799', shadow: '0 2px 10px rgba(0,0,0,0.08)',
     nodeStyles: { start: { bg: '#97ffbd', border: '#73f299', type: '#4a8a4a' }, end: { bg: '#ffd0d0', border: '#fe7171', type: '#8a4a4a' }, process: { bg: '#a8c5fc', border: '#5c8df8', type: '#4a4a8a' }, decision: { bg: '#ffecb2', border: '#f1d100', type: '#7a6030' }, db: { bg: '#b4f0f0', border: '#76e4f0', type: '#3a6a7a' }, api: { bg: '#dfcdfc', border: '#9e6bf7', type: '#6a4a8a' }, io: { bg: '#a6eece', border: '#70f8c8', type: '#3a7a5a' }, 'loop-start': { bg: '#afe4f6', border: '#36c2ed', type: '#3b82f6' }, 'loop-end': { bg: '#f3d19a', border: '#f4a640', type: '#c47a20' } } }
};

function applyTheme(name, { render = true, save = true } = {}) {
  const t = THEMES[name]; if (!t) return;
  state.theme = name;
  const root = document.documentElement;
  root.style.setProperty('--bg', t.bg); root.style.setProperty('--bg2', t.bg2); root.style.setProperty('--bg3', t.bg3);
  root.style.setProperty('--border', t.border); root.style.setProperty('--border2', t.border2);
  root.style.setProperty('--text', t.text); root.style.setProperty('--text2', t.text2); root.style.setProperty('--text3', t.text3);
  root.style.setProperty('--node-bg', t.nodeBg); root.style.setProperty('--node-border', t.nodeBorder);
  root.style.setProperty('--conn', t.conn); root.style.setProperty('--shadow', t.shadow);
  Object.entries(t.nodeStyles).forEach(([type, s]) => {
    root.style.setProperty(`--node-${type}-bg`, s.bg);
    root.style.setProperty(`--node-${type}-border`, s.border);
    root.style.setProperty(`--node-${type}-type`, s.type);
  });
  document.documentElement.classList.toggle('theme-dark',  name === 'dark');
  document.documentElement.classList.toggle('theme-light', name === 'light');
  if (render) renderAll();
  if (save)   autosave();
}


// ユーザーがボタンを押したときは、第2引数が無い（trueになる）ので正しく連動します
function toggleTheme() { applyTheme(state.theme === 'light' ? 'dark' : 'light'); }

// ──────────────────────────────────────────────
// CANVAS BACKGROUND COLOR
// ──────────────────────────────────────────────
// 先頭に「デフォルト」を追加。bgを空文字（''）にすることで、テーマ本来の背景色（--bg）に戻るようにします
const CANVAS_BG_PRESETS = [
  { label: 'デフォルト', bg: '', dot: '' }, 
  { label: 'ダーク', bg: '#131416', dot: '#25272e' }, 
  { label: 'ミッドナイト', bg: '#0b111e', dot: '#1c273a' }, 
  { label: 'ディープ', bg: '#050b1e', dot: '#142042' }, 
  { label: 'スレート', bg: '#1d283d', dot: '#2a3345' }, 
  { label: 'グレー', bg: '#2b2d31', dot: '#3f4248' }, 
  { label: 'ウォーム', bg: '#44271c', dot: '#4f352b' }, 
  { label: 'ライト', bg: '#f4f6fa', dot: '#d7dee9' }, 
  { label: 'クリーム', bg: '#ece7d3', dot: '#e6dec3' }, 
  { label: 'ブルー', bg: '#14254d', dot: '#273f78' }
];

function applyCanvasBg(bg, dot, save = true) {
  state.canvasBg = bg;
  
  if (bg === '') {
    // デフォルトが選ばれたら、インラインの背景スタイルを消してCSSの var(--bg) に委ねる
    canvasWrap.style.background = '';
    state.canvasDot = '';
    
    // ドットの色もテーマ（ライト/ダーク）の標準的な境界線色（--border）に連動させる
    let styleEl = document.getElementById('canvas-bg-style');
    if (styleEl) styleEl.textContent = `#canvas-wrap::before { background-image: radial-gradient(circle, var(--border) 1px, transparent 1px); }`;
  } else {
    // 固定値のカラーコードが選ばれた場合
    state.canvasDot = dot || adjustDotColor(bg);
    canvasWrap.style.background = bg;
    let styleEl = document.getElementById('canvas-bg-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'canvas-bg-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `#canvas-wrap::before { background-image: radial-gradient(circle, ${state.canvasDot} 1px, transparent 1px); }`;
  }
  
  if (save) autosave();
}

function adjustDotColor(bg) {
  // simple luminance check: if light bg, use dark dot; if dark, use lighter dot
  const hex = bg.replace('#','');
  const r = parseInt(hex.substring(0,2),16);
  const g = parseInt(hex.substring(2,4),16);
  const b = parseInt(hex.substring(4,6),16);
  const lum = (r*299 + g*587 + b*114) / 1000;
  return lum > 128 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
}

document.getElementById('btn-canvas-bg').addEventListener('click', () => {
  const grid = document.getElementById('canvas-bg-presets');
  grid.innerHTML = CANVAS_BG_PRESETS.map((p,i) => `
    <div style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid ${(state.canvasBg ?? '') === p.bg ? 'var(--accent)' : 'var(--border)'};transition:border-color 0.12s" data-bg="${p.bg}" data-dot="${p.dot}" title="${p.label}">
      <div style="height:36px;background:${p.bg};position:relative;display:flex;align-items:center;justify-content:center">
        <span style="font-size:8px;font-family:var(--mono);color:${p.bg==='#f5f0e8'||p.bg==='#f8f8fa'||p.bg==='#fafaf5'?'#555':'#888'}">${p.label}</span>
      </div>
    </div>`).join('');
  grid.querySelectorAll('[data-bg]').forEach(el => {
    el.addEventListener('click', () => {
      applyCanvasBg(el.dataset.bg, el.dataset.dot);
      closeModal('modal-canvas-bg');
      notify('背景色を変更しました');
    });
  });
  const custom = document.getElementById('canvas-bg-custom');
  const freshCustom = custom.cloneNode(true);
  custom.parentNode.replaceChild(freshCustom, custom);
  freshCustom.value = state.canvasBg || '';
  freshCustom.addEventListener('input', e => applyCanvasBg(e.target.value));
  freshCustom.addEventListener('change', () => notify('背景色を変更しました'));
  openModal('modal-canvas-bg');
});
