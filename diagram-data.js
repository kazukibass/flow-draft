(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FlowDraftData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KINDS = Object.freeze({
    unspecified: '未指定', control: '制御', data: 'データ',
    event: 'イベント', dependency: '依存'
  });
  const OUTCOMES = Object.freeze({
    unspecified: '未指定', normal: '通常', error: 'エラー', fallback: 'フォールバック'
  });
  const NODE_TYPES = new Set(['start', 'end', 'process', 'decision', 'io', 'db', 'api', 'loop-start', 'loop-end']);
  const PORTS = new Set(['top', 'right', 'bottom', 'left']);
  const ID_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
  const COLOR_RE = /^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/;
  const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX = Object.freeze({ nodes: 10000, conns: 20000, groups: 5000, text: 4096, description: 16384, coord: 10000000 });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function fail(message) { throw new TypeError('Invalid FlowDraft document: ' + message); }
  function record(value, name, optional) {
    if (value == null && optional) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + ' must be an object');
    return value;
  }
  function text(value, name, fallback, limit) {
    if (value == null) return fallback;
    if (typeof value !== 'string') fail(name + ' must be a string');
    if (value.length > (limit || MAX.text)) fail(name + ' is too long');
    return value;
  }
  function number(value, name, fallback, min, max) {
    if (value == null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(name + ' is out of range');
    return value;
  }
  function id(value, name) {
    if (typeof value !== 'string' || !ID_RE.test(value) || RESERVED_IDS.has(value)) fail(name + ' is not a valid ID');
    const numeric = /^[ncg](\d+)$/.exec(value);
    if (numeric && (!Number.isSafeInteger(Number(numeric[1])) || Number(numeric[1]) >= Number.MAX_SAFE_INTEGER))
      fail(name + ' has an unsafe numeric suffix');
    return value;
  }
  function color(value, name) {
    value = text(value, name, '');
    if (value && !COLOR_RE.test(value)) fail(name + ' is not a safe color');
    return value;
  }
  function entries(value, name, limit) {
    const obj = record(value, name, true);
    const list = Object.keys(obj);
    if (list.length > limit) fail(name + ' exceeds the item limit');
    return list.map(key => [key, obj[key]]);
  }
  function assign(out, key, value) { Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true }); }

  function normalizeDocument(raw) {
    raw = record(raw, 'document');
    if (own(raw, 'schemaVersion') && raw.schemaVersion !== 1) fail('unsupported schemaVersion');
    if (!own(raw, 'nodes') || (!own(raw, 'conns') && !own(raw, 'connections')))
      fail('nodes and connections are required');
    const rawNodes = own(raw, 'nodes') ? raw.nodes : {};
    const rawConns = own(raw, 'conns') ? raw.conns : (own(raw, 'connections') ? raw.connections : {});
    const legacy = !own(raw, 'schemaVersion');
    const nodes = {}, conns = {}, groups = {}, semanticConnections = {};

    for (const [key, value] of entries(rawNodes, 'nodes', MAX.nodes)) {
      const n = record(value, 'node ' + key);
      const nodeId = id(n.id == null ? key : n.id, 'node ID');
      if (nodeId.startsWith('conn-')) fail('node ID uses the reserved conn- prefix');
      if (nodeId !== key) fail('node key and ID differ');
      const type = n.type == null ? 'process' : n.type;
      if (!NODE_TYPES.has(type)) fail('node ' + key + ' has an unknown type');
      const item = {
        id: nodeId, type,
        x: number(n.x, 'node x', 0, -MAX.coord, MAX.coord),
        y: number(n.y, 'node y', 0, -MAX.coord, MAX.coord),
        w: number(n.w, 'node width', type === 'decision' ? 165 : 140, 16, 10000),
        label: text(n.label, 'node label', ''),
        sublabel: text(n.sublabel, 'node sublabel', ''),
        color: color(n.color, 'node color'), bgColor: color(n.bgColor, 'node background color')
      };
      assign(nodes, nodeId, item);
    }

    const inlineSemantics = {};
    for (const [key, value] of entries(rawConns, 'connections', MAX.conns)) {
      const c = record(value, 'connection ' + key);
      const connId = id(c.id == null ? key : c.id, 'connection ID');
      if (connId !== key) fail('connection key and ID differ');
      if (own(nodes, connId)) fail('connection ID collides with a node ID');
      const from = id(c.from, 'connection source');
      const to = id(c.to, 'connection target');
      if (!own(nodes, from) || !own(nodes, to)) fail('connection ' + key + ' has a dangling node reference');
      const fromPort = c.fromPort == null ? 'bottom' : c.fromPort;
      const toPort = c.toPort == null ? 'top' : c.toPort;
      if (!PORTS.has(fromPort) || !PORTS.has(toPort)) fail('connection ' + key + ' has an invalid port');
      const item = { id: connId, from, fromPort, to, toPort, label: text(c.label, 'connection label', '') };
      if (own(c, 'bendX') || own(c, 'bendY')) {
        if (!own(c, 'bendX') || !own(c, 'bendY')) fail('connection bend requires both coordinates');
        item.bendX = number(c.bendX, 'connection bendX', 0, -MAX.coord, MAX.coord);
        item.bendY = number(c.bendY, 'connection bendY', 0, -MAX.coord, MAX.coord);
      }
      assign(conns, connId, item);
      if (legacy && (own(c, 'kind') || own(c, 'outcome') || own(c, 'description'))) {
        inlineSemantics[connId] = { kind: c.kind, outcome: c.outcome, description: c.description };
      }
    }

    for (const [key, value] of entries(raw.groups, 'groups', MAX.groups)) {
      const g = record(value, 'group ' + key);
      const groupId = id(g.id == null ? key : g.id, 'group ID');
      if (groupId !== key) fail('group key and ID differ');
      if (own(nodes, groupId) || own(conns, groupId)) fail('group ID collides with another object ID');
      if (!Array.isArray(g.nodeIds) || g.nodeIds.length > MAX.nodes) fail('group nodeIds must be a bounded array');
      const seen = new Set();
      const nodeIds = [];
      for (const rawId of g.nodeIds) {
        const nodeId = id(rawId, 'group node ID');
        if (!own(nodes, nodeId)) { if (legacy) continue; fail('group ' + key + ' has a dangling node reference'); }
        if (!seen.has(nodeId)) { seen.add(nodeId); nodeIds.push(nodeId); }
      }
      assign(groups, groupId, {
        id: groupId, label: text(g.label, 'group label', ''), nodeIds,
        color: color(g.color, 'group color'),
        padding: number(g.padding, 'group padding', 28, 0, 10000),
        splitDistance: number(g.splitDistance, 'group splitDistance', 150, 0, MAX.coord)
      });
    }

    const semantics = own(raw, 'semantics') ? record(raw.semantics, 'semantics') : {};
    for (const key of Object.keys(semantics)) if (key !== 'connections') fail('unknown semantics field ' + key);
    const supplied = own(semantics, 'connections') ? record(semantics.connections, 'semantics.connections') : {};
    for (const key of Object.keys(supplied)) {
      id(key, 'semantic connection ID');
      if (!own(conns, key)) fail('semantic data references an unknown connection');
    }
    for (const connId of Object.keys(conns)) {
      const s = own(supplied, connId) ? record(supplied[connId], 'connection semantic') : (inlineSemantics[connId] || {});
      for (const key of Object.keys(s)) if (!['kind', 'outcome', 'description'].includes(key)) fail('unknown connection semantic field ' + key);
      const kind = s.kind == null ? 'unspecified' : s.kind;
      const outcome = s.outcome == null ? 'unspecified' : s.outcome;
      if (!own(KINDS, kind)) fail('unknown semantic kind');
      if (!own(OUTCOMES, outcome)) fail('unknown semantic outcome');
      assign(semanticConnections, connId, { kind, outcome, description: text(s.description, 'semantic description', '', MAX.description) });
    }

    let highest = 0;
    for (const value of [...Object.keys(nodes), ...Object.keys(conns), ...Object.keys(groups)]) {
      const match = /^[ncg](\d+)$/.exec(value);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    if (own(raw, 'nextId') && (!Number.isSafeInteger(raw.nextId) || raw.nextId <= 0 || raw.nextId >= Number.MAX_SAFE_INTEGER))
      fail('nextId must be a positive safe integer');
    const requestedNext = own(raw, 'nextId') ? raw.nextId : 1;
    if (highest >= Number.MAX_SAFE_INTEGER - 1) fail('IDs leave no safe nextId');
    const nextId = Math.max(requestedNext, highest + 1);
    return { schemaVersion: 1, nodes, conns, groups, nextId, name: text(raw.name, 'document name', '無題のフロー'), semantics: { connections: semanticConnections } };
  }

  function serializeDocument(raw) { return normalizeDocument(raw); }
  function getSemantic(doc, connId) {
    const connections = doc && doc.semantics && doc.semantics.connections;
    if (!connections || typeof connections !== 'object' || !own(connections, connId))
      return { kind: 'unspecified', outcome: 'unspecified', description: '' };
    const s = connections[connId];
    if (!s || typeof s !== 'object') return { kind: 'unspecified', outcome: 'unspecified', description: '' };
    return {
      kind: own(KINDS, s.kind) ? s.kind : 'unspecified',
      outcome: own(OUTCOMES, s.outcome) ? s.outcome : 'unspecified',
      description: typeof s.description === 'string' ? s.description : ''
    };
  }
  function semanticStyle(semantic) {
    semantic = semantic || {};
    const kind = own(KINDS, semantic.kind) ? semantic.kind : 'unspecified';
    const outcome = own(OUTCOMES, semantic.outcome) ? semantic.outcome : 'unspecified';
    const kindStyle = {
      unspecified: ['', ''], control: ['#2563eb', ''], data: ['#059669', '6 3'],
      event: ['#d97706', '2 3'], dependency: ['#7c3aed', '8 3 2 3']
    }[kind];
    let color = kindStyle[0], dash = kindStyle[1];
    if (outcome === 'error') { color = '#dc2626'; dash = '6 3'; }
    else if (outcome === 'fallback') { color = '#d97706'; dash = '3 3'; }
    const labels = [KINDS[kind]];
    if (outcome !== 'unspecified') labels.push(OUTCOMES[outcome]);
    return { color, dash, label: labels.join(' / ') };
  }

  return Object.freeze({ normalizeDocument, serializeDocument, getSemantic, KINDS, OUTCOMES, semanticStyle });
});
