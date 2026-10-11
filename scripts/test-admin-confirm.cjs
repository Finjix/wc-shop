const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const hooks = [];
let cursor = 0;
let cleanup;
const react = {
  createContext: () => ({ Provider: 'Provider' }),
  useContext() {}, useCallback: (callback) => callback,
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], (value) => { hooks[index] = value; }];
  },
  useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
  useEffect(callback) { const index = cursor++; if (!hooks[index]) { hooks[index] = true; cleanup = callback(); } },
};
const exportsObject = {};
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'admin/src/components/ConfirmProvider.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(compiled, {
  exports: exportsObject,
  require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'tdesign-react') return { Dialog: 'Dialog' };
    throw new Error(name);
  },
});
function render() { cursor = 0; return exportsObject.ConfirmProvider({ children: null }); }
const dialog = () => render().props.children[1].props;
async function run() {
  const confirm = render().props.value;
  const deletion = confirm('确定删除评价？', { closeBtn: false });
  assert.equal(dialog().closeBtn, false);
  assert.equal(dialog().children, '确定删除评价？');
  dialog().onConfirm();
  assert.equal(await deletion, true);
  assert.equal(dialog().visible, false);
  const generic = confirm('确定离开吗？');
  assert.equal(dialog().closeBtn, true, 'non-deletion dialogs keep existing behavior');
  dialog().onClose();
  assert.equal(await generic, false);
  const replaced = confirm('确定删除商品？', { closeBtn: false });
  const next = confirm('确定删除分类？', { closeBtn: false });
  assert.equal(await replaced, false);
  dialog().onClose();
  assert.equal(await next, false);
  const unmounted = confirm('确定删除订单？', { closeBtn: false });
  cleanup();
  assert.equal(await unmounted, false);
  const files = ['admin/src/pages/CommercePages.tsx', 'admin/src/pages/Pages.tsx', 'admin/src/pages/CategoriesPage.tsx'];
  const calls = files.flatMap((file) => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/confirm\(`(确定(?:永久)?删除[^`]+)`, \{ closeBtn: false \}\)/g)]);
  assert.equal(calls.length, 5, 'orders, after-sales, reviews, products and categories all use a no-X confirmation');
  for (const call of calls) assert.ok(call[1].endsWith('？'), 'retain the confirmation question without trailing explanatory text');
  console.log('PASS simplified deletion confirmations without close icons; confirm/cancel, replacement and unmount behavior preserved');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
