// ──────────────────────────────────────────────
// AUTOSAVE (localStorage)
// ──────────────────────────────────────────────
function autosave() {
  try {
    localStorage.setItem('flowdraft_data', JSON.stringify({
      nodes:    state.nodes,
      conns:    state.conns,
      nextId:   state.nextId,
      name:     getDiagramName(),
      canvasBg: state.canvasBg  || '',
      canvasDot: state.canvasDot || '',
      theme:    state.theme,
      // history は保存しない（リロード時に古い状態に戻る原因になるため）
    }));
  } catch(e) {}
}

function loadSaved() {
  try {
    const raw = localStorage.getItem('flowdraft_data');
    if (!raw) return false;
    const data = JSON.parse(raw);
    state.nodes    = data.nodes    || {};
    state.conns    = data.conns    || {};
    state.nextId   = data.nextId   || 1;
    state.theme    = data.theme    || 'light';
    // history は復元しない（ロード後の現在状態が履歴の起点になる）
    state.history    = [];
    state.historyIdx = -1;
    if (data.name) setDiagramName(data.name);
    // render/save なしでテーマ適用（二重 renderAll を防ぐ）
    applyTheme(state.theme, { render: false, save: false });
    // canvasBg が '' ならデフォルト扱いで '' を渡す（|| で上書きしない）
    const targetBg  = data.canvasBg  ?? '';
    const targetDot = data.canvasDot ?? '';
    applyCanvasBg(targetBg, targetDot, false);
    return true;
  } catch(e) { return false; }
}

// diagram-name-pc / mobile どちらの変更も autosave に繋ぐ
document.getElementById('diagram-name-pc')?.addEventListener('change', autosave);
document.getElementById('diagram-name-mobile')?.addEventListener('change', autosave);
