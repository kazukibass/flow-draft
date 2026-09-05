'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const scriptOrder = ['diagram-data.js', 'graph-query.js', 'theme.js', 'storage.js', 'export.js', 'app.js', 'view-mode.js'];

async function boot(saved) {
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script\b[^>]*src=[^>]+><\/script>/gi, '');
  const errors = [];
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(window) {
      if (saved) window.localStorage.setItem('flowdraft_data', typeof saved === 'string' ? saved : JSON.stringify(saved));
      window.requestAnimationFrame = cb => window.setTimeout(cb, 0);
      window.alert = () => {};
      window.prompt = () => null;
      window.URL.createObjectURL = () => 'blob:http://localhost/test';
      window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, setTransform() {}, scale() {}, save() {}, restore() {} });
      window.addEventListener('error', e => errors.push(e.error || e.message));
    }
  });
  const context = dom.getInternalVMContext();
  for (const file of scriptOrder) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  // Scripts are evaluated after parsing; allow jsdom's single parser event to
  // reach the app. Do not dispatch a second event (init is intentionally one-shot).
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  await new Promise(resolve => dom.window.setTimeout(resolve, 10));
  return { dom, context, errors };
}

function evaluate(context, expression) { return vm.runInContext(expression, context); }
function stateSnapshot(context) { return evaluate(context, 'JSON.stringify(getDocument())'); }
function checkRuntime(t, runtime) {
  t.after(() => {
    runtime.dom.window.close();
    assert.equal(runtime.errors.length, 0, runtime.errors.map(String).join('\n'));
  });
  assert.equal(runtime.errors.length, 0, runtime.errors.map(String).join('\n'));
}

test('HTML boot initializes the editor without runtime errors', async t => {
  const runtime = await boot(); checkRuntime(t, runtime);
  const { dom, errors } = runtime;
  assert.equal(errors.length, 0, errors.map(String).join('\n'));
  assert.ok(dom.window.document.querySelectorAll('.flow-node').length >= 3);
  assert.equal(dom.window.document.getElementById('view-strip').hidden, true);
});

test('connection semantic editor persists changes and participates in undo/redo', async t => {
  const runtime = await boot(); checkRuntime(t, runtime);
  const { dom, context } = runtime;
  evaluate(context, "selectConn(Object.keys(state.conns)[0])");
  const kind = dom.window.document.getElementById('conn-kind');
  const outcome = dom.window.document.getElementById('conn-outcome');
  const description = dom.window.document.getElementById('conn-description');
  kind.value = 'control'; kind.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  outcome.value = 'error'; outcome.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  description.value = 'failure path'; description.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(evaluate(context, "state.semantics.connections[Object.keys(state.conns)[0]].description"), 'failure path');
  dom.window.document.getElementById('btn-undo').click();
  assert.notEqual(evaluate(context, "state.semantics.connections[Object.keys(state.conns)[0]].description"), 'failure path');
  dom.window.document.getElementById('btn-redo').click();
  assert.equal(evaluate(context, "state.semantics.connections[Object.keys(state.conns)[0]].description"), 'failure path');
  assert.ok(dom.window.localStorage.getItem('flowdraft_data'));
});

test('viewer controls are read-only and view transitions preserve canonical document data', async t => {
  const runtime = await boot(); checkRuntime(t, runtime);
  const { dom, context } = runtime;
  const before = stateSnapshot(context);
  dom.window.document.getElementById('btn-view').click();
  assert.equal(dom.window.document.body.classList.contains('view-mode'), true);
  assert.equal(dom.window.document.getElementById('btn-new').disabled, true);
  assert.equal(dom.window.document.getElementById('diagram-name-pc').readOnly, true);
  const source = dom.window.document.getElementById('view-source');
  source.value = Object.keys(evaluate(context, 'state.nodes'))[0];
  source.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.getElementById('view-query').value = 'downstream';
  dom.window.document.getElementById('view-query').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(stateSnapshot(context), before);
  dom.window.document.getElementById('view-exit').click();
  assert.equal(dom.window.document.body.classList.contains('view-mode'), false);
  assert.equal(stateSnapshot(context), before);
});

test('rendered labels remain text and static SVG geometry survives viewer highlighting', async t => {
  const runtime = await boot(); checkRuntime(t, runtime);
  const { dom, context } = runtime;
  evaluate(context, "state.nodes[Object.keys(state.nodes)[0]].label = '<img src=x onerror=alert(1)>'; renderAll()");
  assert.equal(dom.window.document.querySelectorAll('#canvas img').length, 0);
  const geometry = [...dom.window.document.querySelectorAll('#svg-layer path')].map(el => el.getAttribute('d')).sort();
  dom.window.document.getElementById('btn-view').click();
  const first = dom.window.document.querySelector('.flow-node');
  first.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const after = [...dom.window.document.querySelectorAll('#svg-layer path')].map(el => el.getAttribute('d')).sort();
  assert.deepEqual(after, geometry);
});

test('legacy custom connection labels appear in SVG and unspecified semantics stay visually quiet', async t => {
  const runtime = await boot(); checkRuntime(t, runtime);
  const { dom, context } = runtime;
  evaluate(context, "state.conns[Object.keys(state.conns)[0]].label = 'Custom route'; renderConns()");
  const svgText = [...dom.window.document.querySelectorAll('#svg-layer text, #svg-layer .conn-label')].map(el => el.textContent);
  assert.ok(svgText.includes('Custom route'));
  assert.equal(svgText.some(text => text.includes('未指定')), false);
  const svg = evaluate(context, 'buildExportSVG(getNodeBounds(),40)');
  assert.match(svg, /Custom route/);
  assert.doesNotMatch(svg, /未指定/);
  evaluate(context, "state.semantics.connections[Object.keys(state.conns)[0]] = {kind:'data',outcome:'normal',description:''}");
  const typed = evaluate(context, 'buildExportSVG(getNodeBounds(),40)');
  assert.match(typed, /Custom route/);
  dom.window.document.getElementById('btn-view').click();
  evaluate(context, 'focusViewNode(Object.keys(state.nodes)[0])');
  assert.equal(evaluate(context, 'buildExportSVG(getNodeBounds(),40)'), typed);
});

test('viewer blocks destructive keyboard and pointer controls while preserving groups and data', async t => {
  const runtime = await boot(); checkRuntime(t, runtime);
  const { dom, context } = runtime;
  evaluate(context, "state.groups.g1 = {id:'g1',label:'Group',color:'#abc',nodeIds:Object.keys(state.nodes).slice(0,2)}; renderConns()");
  const before = stateSnapshot(context);
  dom.window.document.getElementById('btn-view').click();
  const body = dom.window.document.body;
  body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  dom.window.document.getElementById('canvas').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  dom.window.document.getElementById('btn-new').click();
  dom.window.document.getElementById('import-file').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(stateSnapshot(context), before);
  evaluate(context, 'renderConns()');
  assert.equal(stateSnapshot(context), before);
});

test('corrupt saved data is retained and does not overwrite the editor storage entry', async t => {
  const corrupt = '{ definitely not json';
  const runtime = await boot(corrupt); checkRuntime(t, runtime);
  const { dom } = runtime;
  assert.equal(dom.window.localStorage.getItem('flowdraft_data'), corrupt);
  dom.window.document.getElementById('btn-undo').click();
  assert.equal(dom.window.localStorage.getItem('flowdraft_data'), corrupt);
  evaluate(runtime.context, 'buildTplGrid()');
  dom.window.document.querySelector('.tpl-item').click();
  assert.notEqual(dom.window.localStorage.getItem('flowdraft_data'), corrupt);
});

test('viewer preserves document, history and saved bytes under editing gestures', async t => {
  const runtime = await boot(); checkRuntime(t,runtime);
  const {dom,context} = runtime, w = dom.window, doc = w.document;
  const before = stateSnapshot(context);
  const saved = w.localStorage.getItem('flowdraft_data');
  const history = evaluate(context, 'JSON.stringify(state.history)');
  doc.getElementById('btn-view').click();
  const node = doc.querySelector('.flow-node');
  node.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,clientX:100,clientY:100}));
  doc.dispatchEvent(new w.MouseEvent('mousemove',{bubbles:true,clientX:150,clientY:150}));
  doc.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true,clientX:150,clientY:150}));
  node.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
  doc.getElementById('canvas').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
  for(const key of ['Delete','Backspace','ArrowRight','c']) doc.body.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true}));
  doc.getElementById('confirm-new').click();
  assert.equal(stateSnapshot(context),before);
  assert.equal(w.localStorage.getItem('flowdraft_data'),saved);
  assert.equal(evaluate(context,'JSON.stringify(state.history)'),history);
  assert.equal(evaluate(context,'state.selected.size'),0);
});

test('file reads are cancelled after entering and leaving viewer before completion', async t => {
  const runtime = await boot(); checkRuntime(t,runtime);
  const {dom,context} = runtime, w = dom.window, doc = w.document;
  let pending;
  w.FileReader = class { constructor(){ pending = this; } readAsText(){} };
  const input = doc.getElementById('import-file');
  Object.defineProperty(input,'files',{configurable:true,value:[new w.File(['{}'],'test.json')]});
  const before = stateSnapshot(context);
  input.dispatchEvent(new w.Event('change',{bubbles:true}));
  doc.getElementById('btn-view').click();
  doc.getElementById('view-exit').click();
  pending.onload({target:{result:JSON.stringify({nodes:{},conns:{},name:'replaced'})}});
  assert.equal(stateSnapshot(context),before);
  assert.match(doc.getElementById('notif').textContent,/中止/);
});

test('mobile menu enters viewer and selects a directed route without changing data', async t => {
  const runtime = await boot(); checkRuntime(t,runtime);
  const {dom,context} = runtime, w = dom.window, doc = w.document;
  Object.defineProperty(w,'innerWidth',{configurable:true,value:390});
  w.dispatchEvent(new w.Event('resize'));
  assert.equal(doc.body.classList.contains('mobile'),true);
  const before = stateSnapshot(context);
  const ids = evaluate(context,'Object.keys(state.nodes)');
  doc.getElementById('m-settings').click();
  doc.getElementById('settings-view').click();
  const select = (id,value) => { const el=doc.getElementById(id); el.value=value; el.dispatchEvent(new w.Event('change',{bubbles:true})); };
  select('view-source',ids[0]);
  select('view-query','route');
  select('view-target',ids[2]);
  assert.match(doc.getElementById('view-status').textContent,/最短経路：2接続/);
  assert.equal(doc.querySelectorAll('[data-conn-id].view-lit').length,2);
  assert.equal(stateSnapshot(context),before);
  doc.getElementById('view-exit').click();
  evaluate(context,"addNode('process',10,10,'new')");
  assert.equal(doc.querySelectorAll('.flow-node').length,4);
});
