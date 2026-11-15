'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const calls = [];
const state = [];
const dependencies = [];
let cursor = 0;
let effects = [];
let fail = false;
const jsx = (type, props) => ({ type, props });
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  },
  useEffect(effect, deps) {
    const index = cursor++;
    if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) {
      dependencies[index] = deps;
      effects.push(effect);
    }
  },
};
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'admin/src/pages/SkuInventoryPage.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports: exportsObject, console, Map, Set, Error,
  window: { setTimeout, clearTimeout },
  require(ref) {
    if (ref === 'react') return react;
    if (ref === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (ref === 'react-router-dom') return {
      useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams()], useBlocker: () => ({ state: 'unblocked' }),
    };
    if (ref.endsWith('/NativeUi')) return { Button: 'Button', Input: 'Input', MessagePlugin: {} };
    if (ref.endsWith('/Ui')) return Object.fromEntries(['EmptyState', 'ErrorState', 'LoadingState', 'Panel', 'Table'].map(name => [name, name]));
    if (ref.endsWith('/useBrowserLeaveWarning')) return { useBrowserLeaveWarning() {} };
    if (ref.endsWith('/sku')) return { visibleSkus: (_product, skus) => skus, variantStock: sku => sku.stockQuantity, groupSkusByPrimary: () => [] };
    if (ref.endsWith('/api')) return { adminApi: { async call(action, payload) {
      calls.push({ action, payload });
      if (fail) throw new Error('模拟超时');
      if (action === 'products.list') return { items: Array.from({ length: 4 }, (_, i) => ({ _id: `p-${payload.page}-${i}`, spuId: `alias-${i}`, title: `商品${i}` })), total: 691 };
      return { items: [{ _id: `sku-${payload.productId}`, stockQuantity: 2 }] };
    } } };
    throw new Error(`Unexpected dependency: ${ref}`);
  },
});
function render() {
  cursor = 0;
  effects = [];
  const tree = exportsObject.SkuInventoryPage();
  effects.forEach(effect => effect());
  return tree;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return; }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function run() {
  render();
  await flush();
  let tree = render();
  assert.equal(calls.length, 5, '691 products still require only one product page and four SKU requests');
  assert.equal(calls[0].payload.pageSize, 4);
  assert.equal(calls[0].payload.page, 1);
  assert(calls.slice(1).every(call => call.payload.productId.startsWith('p-1-')), 'never request duplicate aliases or other pages');
  find(tree, node => node.type === 'Button' && node.props.children === '下一页').props.onClick();
  render();
  await flush();
  tree = render();
  assert.equal(calls.length, 10);
  assert.equal(calls[5].payload.page, 2);
  assert(find(tree, node => node.type === 'span' && node.props.children?.includes(173)), 'total page count uses server total');
  fail = true;
  find(tree, node => node.type === 'Button' && node.props.children === '下一页').props.onClick();
  render(); await flush(); tree = render();
  const error = find(tree, node => node.type === 'ErrorState');
  assert.equal(error.props.message, '模拟超时');
  fail = false;
  error.props.onRetry(); render(); await flush(); tree = render();
  assert(!find(tree, node => node.type === 'ErrorState'));
  assert.equal(calls.at(-5).payload.page, 3, 'retry reads only the failed page');
  find(tree, node => node.type === 'Input').props.onChange('鞋');
  tree = render();
  find(tree, node => node.type === 'Input').props.onEnter('', { e: { preventDefault() {} } });
  render(); await flush(); render();
  assert.equal(calls.at(-5).payload.page, 1, 'search resets pagination');
  assert.equal(calls.at(-5).payload.query, '鞋');
  console.log('PASS inventory bounded first load, page navigation, search, server totals and timeout recovery');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
