const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
let app, page;
const navigation = [];
const context = vm.createContext({
  console, Date, Promise,
  App(value) { app = value; },
  Page(value) { page = value; },
  getApp: () => app,
  wx: { navigateTo: (value) => navigation.push(value), navigateBack() {} },
});

function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute);
  const exports = {};
  cache.set(absolute, exports);
  const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const wrapper = vm.runInContext(`(function(exports, require) { ${source}\n})`, context);
  wrapper(exports, (name) => {
    if (name === 'tdesign-miniprogram/toast/index') return { default() {} };
    if (!name.startsWith('.')) throw new Error(`Unexpected import: ${name}`);
    const dependency = path.resolve(path.dirname(absolute), `${name}.ts`);
    if (dependency === path.join(root, 'common/updateManager.ts')) return { default() {} };
    if (dependency === path.join(root, 'utils/api.ts')) return { getApiErrorMessage: (error) => error.message };
    return load(dependency);
  });
  return exports;
}

async function testAddressSelection() {
  load('app.ts');
  load('pages/order/order-confirm/index.ts');
  const order = { ...page, handleOptionsParams(value) { this.selected = value.userAddressReq; } };
  load('pages/user/address/list/index.ts');
  const addresses = { ...page, selectMode: true };
  order.onGotoAddress();
  assert.match(navigation.at(-1).url, /selectMode=1/);
  const address = { id: 'address-test', name: '测试收货人' };
  addresses.selectHandle({ detail: address });
  await Promise.resolve();
  assert.equal(order.selected.id, address.id);
  assert.equal(order.selected.checked, true);

  order.selected = undefined;
  order.onGotoAddress();
  addresses.hasSelect = false;
  addresses.onUnload();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(order.selected, undefined);

  const cancelled = app.addressSelection.getAddressPromise();
  app.addressSelection.rejectAddress();
  await assert.rejects(cancelled, /cancel/);
  const first = app.addressSelection.getAddressPromise();
  const second = app.addressSelection.getAddressPromise();
  app.addressSelection.resolveAddress(address);
  assert.equal(await first, address);
  assert.equal(await second, address);
  const next = app.addressSelection.getAddressPromise();
  app.addressSelection.resolveAddress({ id: 'next' });
  assert.equal((await next).id, 'next');
  console.log('PASS actual order/address page callbacks share App state; cancellation clears pending requests');
}

function loadDialog(file, state) {
  const exports = {};
  const props = {};
  const propNames = ['buttonLayout', 'cancelBtn', 'closeOnOverlayClick', 'confirmBtn', 'preventScrollThrough', 'showOverlay', 'visible'];
  propNames.forEach((name) => { props[name] = { value: undefined }; });
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'tslib') return require('tslib');
      if (name.endsWith('/props')) return { default: props };
      if (name.endsWith('/utils')) return { getInstance(ctx, selector) { state.selector = selector; return (ctx || state.page).selectComponent(selector); } };
      throw new Error(name);
    },
  });
  return exports.default;
}

async function dialogScenario(file) {
  const component = { properties: { confirmBtn: '确认', cancelBtn: '取消', showOverlay: true }, setData(data) { this.data = data; } };
  const state = { page: { selectComponent: () => component } };
  const dialog = loadDialog(file, state);
  const options = { title: '确认收货？', confirmBtn: { content: '确认收货', rootClass: 'custom-button' } };
  const confirm = dialog.confirm(options);
  assert.equal(state.selector, '#t-dialog');
  assert.equal(component.data.visible, true);
  assert.equal(component.data.confirmBtn, options.confirmBtn);
  const data = JSON.parse(JSON.stringify(component.data));
  component._onConfirm('confirm');
  assert.equal(await confirm, 'confirm');
  const cancelled = dialog.confirm({ context: state.page, selector: '#custom-dialog' });
  const caught = cancelled.catch((error) => error);
  component._onCancel('cancel');
  assert.equal(await caught, 'cancel');
  assert.equal(state.selector, '#custom-dialog');
  const alert = dialog.alert({ content: '请选择订单' });
  component._onConfirm();
  await alert;
  await assert.rejects(dialog.confirm({ context: { selectComponent: () => null } }));
  return data;
}

async function run() {
  testAsyncComponents();
  await testAddressSelection();
  assert.deepEqual(await dialogScenario('pages/order/utils/dialog.ts'), await dialogScenario('node_modules/tdesign-miniprogram/miniprogram_dist/dialog/index.js'));
  console.log('PASS subpackage Dialog matches TDesign confirm/cancel/alert and preserves button styling');
  const order = load('pages/order/utils/format.ts');
  const goods = load('pages/goods/utils/formatTime.ts');
  for (const value of ['2026-10-05T04:00:00Z', 'invalid', '', null, 1791172800000, '1791172800000']) {
    assert.equal(order.formatTime(value, 'YYYY/MM/DD HH:mm:ss'), goods.formatTime(value, 'YYYY/MM/DD HH:mm:ss'));
  }
  assert.equal(order.priceFormat(12345, 2), '123.45');
  assert.equal(load('pages/user/utils/phone.ts').phoneRegCheck('13800000000'), true);
  console.log('PASS split time, price and phone utilities');
}

function testAsyncComponents() {
  const { groups } = require('./build-subpackage-ui.cjs');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const subpackageRoots = (config.subpackages || []).map((pack) => path.resolve(root, pack.root));
  const subpackageOf = (file) => subpackageRoots
    .filter((subpackageRoot) => file === subpackageRoot || file.startsWith(subpackageRoot + path.sep))
    .sort((left, right) => right.length - left.length)[0] || null;
  for (const name of Object.keys(groups)) {
    assert.ok(config.subpackages.some((pack) => pack.root === `packages/${name}`));
  }
  let asyncReferences = 0;
  const loadMoreJson = JSON.parse(fs.readFileSync(path.join(root, 'components/load-more/index.json'), 'utf8'));
  assert.ok(!Object.values(loadMoreJson.usingComponents || {}).some((reference) => reference.startsWith('/packages/order-ui/')),
    'main-package load-more must not synchronously depend on a component in the order-ui subpackage');
  function exists(reference) {
    return ['', '.json', '.js', '.ts', '.wxml', '.wxss', '.wxs'].some((ext) => fs.existsSync(reference + ext));
  }
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      if (/\.(js|ts)$/.test(file)) {
        const sourceSubpackage = subpackageOf(file);
        const content = fs.readFileSync(file, 'utf8');
        for (const match of content.matchAll(/(['"])(\.{1,2}\/[^'"\s]+)\1/g)) {
          const dependency = path.resolve(path.dirname(file), match[2]);
          const targetSubpackage = subpackageOf(dependency);
          assert.ok(
            !targetSubpackage || targetSubpackage === sourceSubpackage,
            `${file}: synchronous JavaScript import crosses into subpackage ${path.relative(root, targetSubpackage || '')}`,
          );
        }
      }
      if (file.endsWith('.json')) {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [alias, reference] of Object.entries(json.usingComponents || {})) {
          if (!reference.startsWith('/packages/')) continue;
          assert.ok(json.componentPlaceholder?.[alias], `${file}: missing placeholder for ${alias}`);
          assert.ok(exists(path.join(root, reference.slice(1))), `${file}: missing ${reference}`);
          asyncReferences++;
        }
      }
      if (!file.includes(`${path.sep}packages${path.sep}`) || !/\.(js|json|wxss|wxml|wxs)$/.test(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const match of content.matchAll(/(['"])(\.{1,2}\/[^'"\s]+)\1/g)) {
        const dependency = path.resolve(path.dirname(file), match[2]);
        assert.ok(dependency.startsWith(root + path.sep), `${file}: dependency outside workspace`);
        assert.ok(exists(dependency), `${file}: unresolved dependency ${match[2]}`);
        const sibling = Object.keys(groups).find((name) => dependency.startsWith(path.join(root, 'packages', name) + path.sep));
        if (sibling) assert.ok(file.startsWith(path.join(root, 'packages', sibling) + path.sep), `${file}: synchronous import from another subpackage`);
      }
    }
  }
  ['pages', 'components', 'packages'].forEach((dir) => inspect(path.join(root, dir)));
  assert.ok(asyncReferences > 0);
  console.log(`PASS ${asyncReferences} async component references, placeholders and generated dependency paths`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
