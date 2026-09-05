// ──────────────────────────────────────────────
// AUTOSAVE (localStorage)
// ──────────────────────────────────────────────
function autosave() {
  if (!canEdit() || state.saveBlocked) return;
  try {
    localStorage.setItem('flowdraft_data', JSON.stringify({
      ...getDocument(),
      canvasBg: state.canvasBg  || '',
      canvasDot: state.canvasDot || '',
      theme:    state.theme,
      // history は保存しない（リロード時に古い状態に戻る原因になるため）
    }));
    const saveStatus = document.getElementById('st-save');
    if (saveStatus) saveStatus.textContent = '自動保存済み';
  } catch(e) {
    const saveStatus = document.getElementById('st-save');
    if (saveStatus) saveStatus.textContent = '保存できませんでした（JSONで保存できます）';
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem('flowdraft_data');
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Validate the complete graph before changing any live state.
    applyDocument(data);

    const isHexColor = value => value === '' ||
      (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value));
    const theme = Object.prototype.hasOwnProperty.call(THEMES, data.theme)
      ? data.theme
      : 'light';
    const targetBg = isHexColor(data.canvasBg) ? data.canvasBg : '';
    const targetDot = isHexColor(data.canvasDot) ? data.canvasDot : '';

    // history は復元しない（ロード後の現在状態が履歴の起点になる）
    state.history    = [];
    state.historyIdx = -1;
    // render/save なしでテーマ適用（二重 renderAll を防ぐ）
    applyTheme(theme, { render: false, save: false });
    // canvasBg が '' ならデフォルト扱いで '' を渡す（|| で上書きしない）
    applyCanvasBg(targetBg, targetDot, false);
    return true;
  } catch(e) {
    state.saveBlocked = true;
    notify('保存データを読み込めませんでした。元データは保持します。');
    const status = document.getElementById('st-save');
    if (status) status.textContent = '元の保存データを保護中：新規作成かJSON読込で再開';
    return false;
  }
}

// diagram-name-pc / mobile どちらの変更も autosave に繋ぐ
document.getElementById('diagram-name-pc')?.addEventListener('change', autosave);
document.getElementById('diagram-name-mobile')?.addEventListener('change', autosave);
