'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FlowDraftData = require('../diagram-data.js');
const FlowDraftGraph = require('../graph-query.js');

const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  return {
    nodes: {
      a: { id: 'a', x: 20, y: 30, w: 180, label: 'Start' },
      b: { id: 'b', x: 260, y: 30, w: 180, label: 'Middle' },
      c: { id: 'c', x: 500, y: 30, w: 180, label: 'End' },
      d: { id: 'd', x: 500, y: 220, w: 180, label: 'Side' }
    },
    conns: {
      c10: { id: 'c10', from: 'a', to: 'b', fromPort: 'right', toPort: 'left', label: 'go', bendX: 190, bendY: 90 },
      c20: { id: 'c20', from: 'b', to: 'c' },
      c30: { id: 'c30', from: 'b', to: 'd' }
    },
    groups: { g1: { id: 'g1', label: 'Lane', color: '#abc', nodeIds: ['a', 'b'] } },
    nextId: 1,
    name: 'Example',
    history: [{ nodes: { stale: true } }],
    view: { zoom: 2, panX: 10, panY: 20 }
  };
}

test('legacy data round-trips visual fields, groups and IDs while repairing nextId', () => {
  const raw = fixture();
  const doc = FlowDraftData.normalizeDocument(raw);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.name, 'Example');
  assert.equal(doc.nodes.a.label, raw.nodes.a.label);
  assert.equal(doc.conns.c10.bendX, raw.conns.c10.bendX);
  assert.equal(doc.conns.c10.bendY, raw.conns.c10.bendY);
  assert.equal(doc.groups.g1.label, raw.groups.g1.label);
  assert.deepEqual(doc.groups.g1.nodeIds, raw.groups.g1.nodeIds);
  assert.equal(doc.groups.g1.color, raw.groups.g1.color);
  assert.deepEqual(Object.keys(doc.nodes), ['a', 'b', 'c', 'd']);
  assert.ok(doc.nextId > 1);
  const serialized = FlowDraftData.serializeDocument(doc);
  for (const id of Object.keys(raw.nodes)) {
    for (const field of ['id', 'x', 'y', 'w', 'label']) assert.equal(serialized.nodes[id][field], raw.nodes[id][field]);
  }
  for (const id of Object.keys(raw.conns)) {
    for (const field of ['id', 'from', 'to', 'fromPort', 'toPort', 'label', 'bendX', 'bendY']) {
      if (field in raw.conns[id]) assert.equal(serialized.conns[id][field], raw.conns[id][field]);
    }
  }
  assert.equal(serialized.history, undefined);
  assert.equal(serialized.view, undefined);
});

test('semantic metadata survives normalization and serialization', () => {
  const raw = fixture();
  raw.schemaVersion = 1;
  raw.semantics = { connections: { c10: { kind: 'control', outcome: 'normal', description: 'continue' } } };
  const doc = FlowDraftData.normalizeDocument(raw);
  assert.deepEqual(FlowDraftData.getSemantic(doc, 'c10'), raw.semantics.connections.c10);
  assert.deepEqual(FlowDraftData.getSemantic(FlowDraftData.serializeDocument(doc), 'c10'), raw.semantics.connections.c10);
  assert.equal(FlowDraftData.getSemantic(doc, 'missing').kind, 'unspecified');
});

test('invalid input is rejected atomically and does not mutate caller data', () => {
  const raw = fixture();
  raw.schemaVersion = 99;
  const before = clone(raw);
  assert.throws(() => FlowDraftData.normalizeDocument(raw), /version|schema/i);
  assert.deepEqual(raw, before);
  assert.throws(() => FlowDraftData.normalizeDocument({ nodes: [], conns: {}, groups: {} }), /node|object|malformed/i);
  assert.throws(() => FlowDraftData.normalizeDocument({ nodes: { '1': { id: 1 } }, conns: {}, groups: {} }), /ID|string|invalid/i);
  assert.throws(() => FlowDraftData.normalizeDocument(JSON.parse('{"nodes":{"__proto__":{"id":"polluted"}},"conns":{},"groups":{}}')), /ID|differ|invalid/i);
  assert.throws(() => FlowDraftData.normalizeDocument({ nodes: { a: {} }, conns: { x: { from: 'a', to: 'z' } }, groups: {} }), /endpoint|reference|invalid/i);
  assert.throws(() => FlowDraftData.normalizeDocument({ nodes: { a: {} }, conns: {}, groups: {}, semantics: { connections: { z: { kind: 'bogus' } } } }), /kind|enum|invalid/i);
});

test('semantic constants and styles cover all documented values', () => {
  for (const kind of ['unspecified', 'control', 'data', 'event', 'dependency']) {
    assert.ok(Object.prototype.hasOwnProperty.call(FlowDraftData.KINDS, kind));
    assert.ok(FlowDraftData.semanticStyle({ kind, outcome: 'normal' }));
  }
  for (const outcome of ['unspecified', 'normal', 'error', 'fallback']) assert.ok(Object.prototype.hasOwnProperty.call(FlowDraftData.OUTCOMES, outcome));
});

test('directed reach supports direction and semantic kind filters', () => {
  const doc = FlowDraftData.normalizeDocument({ ...fixture(), semantics: { connections: {
    c10: { kind: 'control', outcome: 'normal' }, c20: { kind: 'data', outcome: 'normal' }, c30: { kind: 'control', outcome: 'error' }
  } } });
  assert.deepEqual(FlowDraftGraph.reach(doc, 'a', 'downstream'), { nodeIds: ['a', 'b', 'c', 'd'], connIds: ['c10', 'c20', 'c30'] });
  assert.deepEqual(FlowDraftGraph.reach(doc, 'c', 'upstream'), { nodeIds: ['c', 'b', 'a'], connIds: ['c20', 'c10'] });
  assert.deepEqual(FlowDraftGraph.reach(doc, 'a', 'downstream', 'control').connIds, ['c10', 'c30']);
  assert.deepEqual(FlowDraftGraph.reach(doc, 'missing'), { nodeIds: [], connIds: [] });
});

test('route returns shortest deterministic paths and handles filters/no route', () => {
  const raw = fixture();
  raw.conns.c05 = { id: 'c05', from: 'a', to: 'b' }; // parallel edge; lexical order wins
  raw.semantics = { connections: { c05: { kind: 'data' }, c10: { kind: 'control' }, c20: { kind: 'data' }, c30: { kind: 'control' } } };
  const doc = FlowDraftData.normalizeDocument(raw);
  assert.deepEqual(FlowDraftGraph.route(doc, 'a', 'c'), { nodeIds: ['a', 'b', 'c'], connIds: ['c05', 'c20'], found: true, multiple: true });
  assert.deepEqual(FlowDraftGraph.route(doc, 'a', 'c', 'control'), { nodeIds: [], connIds: [], found: false, multiple: false });
  assert.deepEqual(FlowDraftGraph.route(doc, 'c', 'a', 'all'), { nodeIds: [], connIds: [], found: false, multiple: false });
  assert.deepEqual(FlowDraftGraph.route(doc, 'a', 'd', 'data').found, false);
});

test('reach and route terminate on cycles', () => {
  const raw = fixture();
  raw.conns.c40 = { id: 'c40', from: 'c', to: 'a' };
  const doc = FlowDraftData.normalizeDocument(raw);
  assert.deepEqual(FlowDraftGraph.reach(doc, 'a').nodeIds, ['a', 'b', 'c', 'd']);
  assert.equal(FlowDraftGraph.route(doc, 'a', 'a').found, true);
});
