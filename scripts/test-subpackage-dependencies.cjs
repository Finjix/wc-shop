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
  const absolute = require("./miniprogram-test-source.cjs").resolveSource(path.resolve(root, file));
  if (cache.has(absolute)) return cache.get(absolute);
  const exports = {};
  cache.set(absolute, exports);
  const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const wrapper = vm.runInContext(`(function(exports, require) { ${source}\n})`, context);
  wrapper(exports, (name) => {
    name = name.replace(/^.*\/tdesign\//, 'tdesign-miniprogram/');
    if (name === 'tdesign-miniprogram/toast/index') return { default() {} };
    if (!name.startsWith('.')) throw new Error(`Unexpected import: ${name}`);
    const dependency = path.resolve(path.dirname(absolute), `${name}.ts`);
    if (dependency === path.join(root, 'miniprogram/common/updateManager.ts')) return { default() {} };
    if (dependency === path.join(root, 'miniprogram/services/utils/api.ts')) return { getApiErrorMessage: (error) => error.message };
    return load(dependency);
  });
  return exports;
}

async function testAddressSelection() {
  load('miniprogram/app.ts');
  load('miniprogram/order/order-confirm/index.ts');
  const order = { ...page, handleOptionsParams(value) { this.selected = value.userAddressReq; } };
  load('miniprogram/user/address/list/index.ts');
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

async function testAddressEditDefaultSwitch() {
  load('miniprogram/user/address/edit/index.ts');
  const edit = {
    ...page,
    data: JSON.parse(JSON.stringify(page.data)),
    privateData: {},
    setData(values, done) { Object.assign(this.data, values); done?.(); },
    onVerifyInputLegal() { return { isLegal: true, tips: '' }; },
  };
  const service = load('miniprogram/services/address/fetchAddress.ts');
  const originalFetch = service.fetchDeliveryAddress;
  try {
    for (const value of [true, 1, '1', 'true', false, 0, '0', 'false']) {
      service.fetchDeliveryAddress = async () => ({ addressId: 'address-test', name: '测试', isDefault: value });
      await edit.getAddressDetail('address-test');
      assert.equal(edit.data.locationState.isDefault, [true, 1, '1', 'true'].includes(value));
      assert.equal(typeof edit.data.locationState.isDefault, 'boolean');
      assert.equal(edit.data.locationState.isEdit, true);
      assert.equal(edit.data.locationState.addressId, 'address-test');
    }
  } finally {
    service.fetchDeliveryAddress = originalFetch;
  }
  console.log('PASS address editing restores the default switch as a boolean for numeric, string and boolean flags');
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
  const options = { title: '确认收货？', confirmBtn: { content: '确定', rootClass: 'custom-button' } };
  const confirm = dialog.confirm(options);
  assert.equal(state.selector, '#t-dialog');
  assert.equal(component.data.visible, true);
  assert.equal(component.data.confirmBtn.content, options.confirmBtn.content);
  assert.equal(component.data.confirmBtn.rootClass, options.confirmBtn.rootClass);
  const data = JSON.parse(JSON.stringify(component.data));
  if (file === 'miniprogram/order/utils/dialog.ts') {
    assert.match(component.data.confirmBtn.style, /order: -1/);
    delete data.confirmBtn.style;
  }
  component._onConfirm('confirm');
  assert.equal(await confirm, 'confirm');
  const cancelled = dialog.confirm({ context: state.page, selector: '#custom-dialog' });
  const caught = cancelled.catch((error) => error);
  component._onCancel('cancel');
  assert.equal(await caught, 'cancel');
  assert.equal(state.selector, '#custom-dialog');
  if (file === 'miniprogram/order/utils/dialog.ts') {
    const custom = dialog.confirm({ confirmBtn: { content: '删除', disabled: true }, cancelBtn: '暂不删除' });
    assert.equal(component.data.confirmBtn.content, '确定');
    assert.equal(component.data.confirmBtn.disabled, true);
    assert.equal(component.data.cancelBtn, '取消');
    component._onConfirm();
    await custom;
  }
  const alert = dialog.alert({ content: '请选择订单' });
  if (file === 'miniprogram/order/utils/dialog.ts') {
    assert.equal(component.data.confirmBtn.content, '确定');
    assert.equal(component.data.cancelBtn, '');
  }
  component._onConfirm();
  await alert;
  await assert.rejects(dialog.confirm({ context: { selectComponent: () => null } }));
  return data;
}

async function run() {
  testAsyncComponents();
  await testAddressSelection();
  await testAddressEditDefaultSwitch();
  assert.deepEqual(await dialogScenario('miniprogram/order/utils/dialog.ts'), await dialogScenario('node_modules/tdesign-miniprogram/miniprogram_dist/dialog/index.js'));
  console.log('PASS subpackage Dialog matches TDesign confirm/cancel/alert and preserves button styling');
  const order = load('miniprogram/services/order/utils/format.ts');
  const goods = load('miniprogram/services/goods/utils/formatTime.ts');
  for (const value of ['2026-10-05T04:00:00Z', 'invalid', '', null, 1791172800000, '1791172800000']) {
    assert.equal(order.formatTime(value, 'YYYY/MM/DD HH:mm:ss'), goods.formatTime(value, 'YYYY/MM/DD HH:mm:ss'));
  }
  assert.equal(order.priceFormat(12345, 2), '123.45');
  assert.equal(load('miniprogram/user/utils/phone.ts').phoneRegCheck('13800000000'), true);
  console.log('PASS split time, price and phone utilities');
}

function testAsyncComponents() { require('./check-package-boundaries.cjs').check(); }
run().catch(error => { console.error(error); process.exitCode = 1; });
