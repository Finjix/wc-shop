const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const listeners = new Map();
let previous, registrations = 0, removals = 0;
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('admin/src/lib/useBrowserLeaveWarning.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: exportsObject,
  require: () => ({ useEffect(effect, deps) {
    if (previous && deps.every((dep, index) => dep === previous.deps[index])) return;
    previous?.cleanup?.();
    previous = { deps, cleanup: effect() };
  } }),
  window: {
    addEventListener(name, handler) { assert.equal(name, 'beforeunload'); listeners.set(name, handler); registrations++; },
    removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); removals++; },
  },
});
const { useBrowserLeaveWarning } = exportsObject;
useBrowserLeaveWarning(false);
assert.equal(listeners.size, 0, 'pristine forms do not interfere with browser navigation');
useBrowserLeaveWarning(true);
assert.equal(listeners.size, 1);
let prevented = false;
const event = { returnValue: undefined, preventDefault() { prevented = true; } };
listeners.get('beforeunload')(event);
assert.equal(prevented, true);
assert.equal(event.returnValue, '', 'legacy browser fallback must be set');
useBrowserLeaveWarning(true);
assert.equal(registrations, 1, 'rerenders do not duplicate the listener');
useBrowserLeaveWarning(false);
assert.equal(listeners.size, 0, 'successful save or reverting changes removes the warning');
useBrowserLeaveWarning(true);
previous.cleanup();
assert.equal(listeners.size, 0, 'unmount removes the browser listener');
assert.equal(removals, 2);
for (const page of ['Pages', 'HomeContentPage', 'CategoriesPage', 'SkuInventoryPage']) {
  const source = fs.readFileSync(`admin/src/pages/${page}.tsx`, 'utf8');
  assert.match(source, /useBrowserLeaveWarning\([^;]+\)/, `${page} must register a browser leave warning`);
}
console.log('PASS browser leave warning: clean/dirty/save lifecycle, native cancellation, legacy fallback, no duplicate listeners, unmount cleanup and all editable pages');
