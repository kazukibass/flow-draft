// ──────────────────────────────────────────────
// EXPORT
// ──────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => openModal('modal-export'));

document.getElementById('exp-svg').addEventListener('click', () => {
  const bounds = getNodeBounds();
  const pad    = 40;
  const svgStr = buildExportSVG(bounds, pad);
  const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
  const a      = document.createElement('a');
  a.href       = URL.createObjectURL(blob);
  a.download   = (getDiagramName() || 'flowchart') + '.svg';
  a.click();
  closeModal('modal-export');
  notify('SVGを保存しました');
});

document.getElementById('exp-png').addEventListener('click', () => {
  const bounds = getNodeBounds();
  const pad    = 40;
  const svgStr = buildExportSVG(bounds, pad);
  const scale  = 2;
  const w      = (bounds.maxX - bounds.minX + pad * 2) * scale;
  const h      = (bounds.maxY - bounds.minY + pad * 2) * scale;
  const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
  const url    = URL.createObjectURL(blob);
  const img    = new Image();
  img.onload = () => {
    const cv  = document.createElement('canvas');
    cv.width  = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // 背景色を塗ってから描画（fillStyle を設定しないと透明になる）
    ctx.fillStyle = state.canvasBg || (typeof THEMES !== 'undefined' ? THEMES[state.theme]?.bg : null) || '#f5f6f8';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    cv.toBlob(b => {
      const a   = document.createElement('a');
      a.href    = URL.createObjectURL(b);
      a.download = (getDiagramName() || 'flowchart') + '.png';
      a.click();
      notify('PNGを保存しました');
    });
    URL.revokeObjectURL(url);
  };
  img.src = url;
  closeModal('modal-export');
});

document.getElementById('exp-json').addEventListener('click', () => {
  const name = getDiagramName();
  const data = JSON.stringify(getDocument(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = (name || 'flowchart') + '.json';
  a.click();
  closeModal('modal-export');
  notify('JSONを保存しました');
});

document.getElementById('import-file').addEventListener('change', e => {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  if (!canEdit()) {
    input.value = '';
    notify('閲覧中は読み込めません');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    input.value = '';
    notify('ファイルが大きすぎます（上限5MB）');
    return;
  }
  const reader = new FileReader();
  const modeRevision = viewState.revision;
  reader.onload = ev => {
    if (!canEdit() || modeRevision !== viewState.revision) {
      input.value = '';
      notify('閲覧中のため読み込みを中止しました');
      return;
    }
    try {
      const data   = JSON.parse(ev.target.result);
      applyDocument(data);
      snapshot(); renderAll(); fitView();
      closeModal('modal-export');
      notify('読み込みました');
    } catch(ex) {
      notify('有効なFlowDraftファイルではありません');
    } finally {
      input.value = '';
    }
  };
  reader.onerror = () => {
    input.value = '';
    notify('ファイルを読み込めませんでした');
  };
  reader.readAsText(file);
});

// ──────────────────────────────────────────────
// EXPORT HELPERS
// ──────────────────────────────────────────────
function getNodeBounds() {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const el = document.getElementById('node-' + n.id);
    const h  = el ? el.offsetHeight : 40;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + h);
  });
  return { minX, minY, maxX, maxY };
}

function buildExportSVG(bounds, pad) {
  const W  = bounds.maxX - bounds.minX + pad * 2;
  const H  = bounds.maxY - bounds.minY + pad * 2;
  const ox = pad - bounds.minX;
  const oy = pad - bounds.minY;

  // DOM の computedStyle からノードの実際の色を取得
  // フォールバックは THEMES.nodeStyles の bg/border/type（オブジェクト形式）
  const resolveNodeStyle = (n) => {
    const el = document.getElementById('node-' + n.id);
    if (el) {
      const bodyEl = el.querySelector('.node-body');
      if (bodyEl) {
        const s = window.getComputedStyle(bodyEl);
        return {
          bg:     s.backgroundColor || '#fff',
          border: s.borderTopColor  || '#999',
          text:   s.color           || '#222',
        };
      }
    }
    // DOM が取得できない場合のフォールバック
    const theme  = (typeof THEMES !== 'undefined' && THEMES[state.theme]) ? THEMES[state.theme] : null;
    const styled = theme ? theme.nodeStyles[n.type] : null;
    return {
      bg:     n.bgColor  || (styled?.bg)     || '#ffffff',
      border: (styled?.border) || '#999999',
      text:   (styled?.type)   || '#222222',
    };
  };

  let regions = '';
  Object.values(state.groups).forEach(group => {
    groupIslands(group).forEach((boxes, islandIndex) => {
      const d = organicPath(boxes).replace(/([MQ]) ([0-9.-]+) ([0-9.-]+)/g,
        (_, command, x, y) => `${command} ${+x + ox} ${+y + oy}`);
      if (!d) return;
      regions += `<path d="${d}" fill="${group.color || '#5b9cf6'}" fill-opacity="0.094" stroke="${group.color || '#5b9cf6'}" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="7 5"/>`;
      const top = boxes.reduce((best, box) => box.y < best.y ? box : best, boxes[0]);
      const label = islandIndex ? `${group.label} · ${islandIndex + 1}` : group.label;
      regions += `<text x="${top.x + ox + 10}" y="${top.y + oy - 8}" font-size="11" fill="${group.color || '#5b9cf6'}" font-family="monospace">${escHtml(label)}</text>`;
    });
  });

  let paths = '';
  const exportDocument = getDocument();
  Object.values(state.conns).forEach(c => {
    const from = getPortPos(c.from, c.fromPort);
    const to   = getPortPos(c.to,   c.toPort);
    const p    = bezierPath(from, to, c.fromPort, c.toPort, c);
    const semantic = FlowDraftData.getSemantic(exportDocument, c.id);
    const semanticVisual = FlowDraftData.semanticStyle(semantic);
    const stroke = semanticVisual.color || '#555';
    const dash = semanticVisual.dash ? ` stroke-dasharray="${escHtml(String(semanticVisual.dash))}"` : '';
    paths += `<path d="${p
      .replace(/M ([0-9.-]+) ([0-9.-]+)/g, (_, x, y) => `M ${+x + ox} ${+y + oy}`)
      .replace(/C ([0-9.-]+) ([0-9.-]+) ([0-9.-]+) ([0-9.-]+) ([0-9.-]+) ([0-9.-]+)/g,
        (_, x1, y1, x2, y2, x3, y3) =>
          `C ${+x1+ox} ${+y1+oy} ${+x2+ox} ${+y2+oy} ${+x3+ox} ${+y3+oy}`)
    }" fill="none" stroke="${stroke}" stroke-width="1.5"${dash} marker-end="url(#arr)"/>`;
    const connectionLabel = c.label || (semantic.kind !== 'unspecified' || semantic.outcome !== 'unspecified' ? semanticVisual.label : '');
    if (connectionLabel) {
      const mid = bezierMidpoint(from, to, c.fromPort, c.toPort, c);
      const mx = mid.x + ox;
      const my = mid.y + oy;
      paths += `<text x="${mx}" y="${my - 4}" text-anchor="middle" font-size="10" fill="${stroke}" font-family="monospace">${escHtml(connectionLabel)}</text>`;
    }
  });

  let rects = '';
  Object.values(state.nodes).forEach(n => {
    const el = document.getElementById('node-' + n.id);
    const h  = el ? el.offsetHeight : 40;
    const x  = n.x + ox, y = n.y + oy;
    const { bg, border, text } = resolveNodeStyle(n);
    rects += `<rect x="${x}" y="${y}" width="${n.w}" height="${h}" rx="6" fill="${bg}" stroke="${border}" stroke-width="1.5"/>`;
    rects += `<text x="${x + n.w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${text}" font-family="sans-serif">${escHtml(n.label)}</text>`;
  });

  const canvasBg = state.canvasBg || (typeof THEMES !== 'undefined' ? THEMES[state.theme]?.bg : null) || '#f5f6f8';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">
  <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
  <rect width="${W}" height="${H}" fill="${canvasBg}"/>
  ${regions}
  ${paths}
  ${rects}
</svg>`;
}
