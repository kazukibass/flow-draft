(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FlowDraftGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function semanticKind(doc, connId) {
    return doc && doc.semantics && doc.semantics.connections && doc.semantics.connections[connId]
      ? doc.semantics.connections[connId].kind || 'unspecified' : 'unspecified';
  }
  function adjacency(doc, direction, kind) {
    const nodes = doc && doc.nodes && typeof doc.nodes === 'object' ? doc.nodes : {};
    const conns = doc && doc.conns && typeof doc.conns === 'object' ? doc.conns : {};
    const map = new Map(Object.keys(nodes).map(id => [id, []]));
    Object.keys(conns).sort().forEach(connId => {
      const c = conns[connId];
      if (!c || !Object.prototype.hasOwnProperty.call(nodes, c.from) || !Object.prototype.hasOwnProperty.call(nodes, c.to)) return;
      if (kind !== 'all' && semanticKind(doc, connId) !== kind) return;
      if (direction === 'downstream') map.get(c.from).push({ connId, nodeId: c.to });
      else map.get(c.to).push({ connId, nodeId: c.from });
    });
    return { nodes, map };
  }
  function reach(doc, start, direction, kind) {
    direction = direction == null ? 'downstream' : direction;
    kind = kind == null ? 'all' : kind;
    if (direction !== 'downstream' && direction !== 'upstream') throw new TypeError('direction must be downstream or upstream');
    const graph = adjacency(doc, direction, kind);
    if (!Object.prototype.hasOwnProperty.call(graph.nodes, start)) return { nodeIds: [], connIds: [] };
    const seenNodes = new Set([start]), seenConns = new Set(), queue = [start];
    for (let head = 0; head < queue.length; head++) {
      for (const edge of graph.map.get(queue[head])) {
        seenConns.add(edge.connId);
        if (!seenNodes.has(edge.nodeId)) { seenNodes.add(edge.nodeId); queue.push(edge.nodeId); }
      }
    }
    return { nodeIds: Array.from(seenNodes), connIds: Array.from(seenConns) };
  }
  function route(doc, start, target, kind) {
    kind = kind == null ? 'all' : kind;
    const graph = adjacency(doc, 'downstream', kind);
    if (!Object.prototype.hasOwnProperty.call(graph.nodes, start) || !Object.prototype.hasOwnProperty.call(graph.nodes, target))
      return { nodeIds: [], connIds: [], found: false, multiple: false };
    if (start === target) return { nodeIds: [start], connIds: [], found: true, multiple: false };
    const distance = new Map([[start, 0]]), ways = new Map([[start, 1]]), parent = new Map(), queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const from = queue[head], nextDistance = distance.get(from) + 1;
      if (distance.has(target) && nextDistance > distance.get(target)) break;
      for (const edge of graph.map.get(from)) {
        if (!distance.has(edge.nodeId)) {
          distance.set(edge.nodeId, nextDistance);
          ways.set(edge.nodeId, ways.get(from));
          parent.set(edge.nodeId, { nodeId: from, connId: edge.connId });
          queue.push(edge.nodeId);
        } else if (distance.get(edge.nodeId) === nextDistance) {
          ways.set(edge.nodeId, Math.min(2, ways.get(edge.nodeId) + ways.get(from)));
        }
      }
    }
    if (!distance.has(target)) return { nodeIds: [], connIds: [], found: false, multiple: false };
    const nodeIds = [], connIds = [];
    for (let cursor = target; cursor !== start;) {
      nodeIds.push(cursor);
      const step = parent.get(cursor);
      connIds.push(step.connId); cursor = step.nodeId;
    }
    nodeIds.push(start); nodeIds.reverse(); connIds.reverse();
    return { nodeIds, connIds, found: true, multiple: ways.get(target) > 1 };
  }
  return Object.freeze({ reach, route });
});
