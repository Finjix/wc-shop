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
    if (name.endsWith('/common/ui/toast')) name = 'native-toast';
    if (name === 'native-toast') return { default() {} };
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
  load('miniprogram/pages/order/order-confirm/index.ts');
  const order = { ...page, handleOptionsParams(value) { this.selected = value.userAddressReq; } };
  load('miniprogram/pages/user/address/list/index.ts');
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
  load('miniprogram/pages/user/address/edit/index.ts');
  const edit = {
    ...page,
    data: JSON.parse(JSON.stringify(page.data)),
    privateData: {},
    setData(values, done) { Object.assign(this.data, values); done?.(); },
    onVerifyInputLegal() { return { isLegal: true, tips: '' }; },
  };
  const service = load('miniprogram/services/address/fetchAddress.ts');
  edit.applyLocationState({ name: '测试', phone: '13800000000', provinceName: '广东省', cityName: '广州市', districtName: '荔湾区', detailAddress: '中山路1号101室' });
  assert.equal(edit.data.locationState.detailAddress, '广东省广州市荔湾区中山路1号101室');
  assert.equal(edit.data.locationState.provinceName, '');
  assert.equal(page.onVerifyInputLegal.call(edit).isLegal, true);
  edit.applyLocationState(edit.data.locationState);
  assert.equal(edit.data.locationState.detailAddress, '广东省广州市荔湾区中山路1号101室');
  edit.data.locationState.detailAddress = ' ';
  assert.equal(page.onVerifyInputLegal.call(edit).isLegal, false);
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
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    getCurrentPages: () => [state.page],

  });
  return exports.default;
}

async function dialogScenario(file) {
  const component = { properties: { confirmBtn: '确认', cancelBtn: '取消', showOverlay: true }, setData(data) { this.data = data; } };
  const state = { page: { selectComponent: (selector) => { state.selector = selector; return component; } } };
  const dialog = loadDialog(file, state);
  const options = { title: '确认收货？', confirmBtn: { content: '确定', rootClass: 'custom-button' } };
  const confirm = dialog.confirm(options);
  assert.equal(state.selector, '#t-dialog');
  assert.equal(component.data.visible, true);
  assert.equal(component.data.confirmBtn.content, options.confirmBtn.content);
  assert.equal(component.data.confirmBtn.rootClass, options.confirmBtn.rootClass);
  const data = JSON.parse(JSON.stringify(component.data));
  if (file === 'miniprogram/pages/_shared/frontend/order/utils/dialog.ts') {

  }
  component._onConfirm('confirm');
  assert.equal(await confirm, 'confirm');
  const cancelled = dialog.confirm({ context: state.page, selector: '#custom-dialog' });
  const caught = cancelled.catch((error) => error);
  component._onCancel('cancel');
  assert.equal(await caught, 'cancel');
  assert.equal(state.selector, '#custom-dialog');
  if (file === 'miniprogram/pages/_shared/frontend/order/utils/dialog.ts') {
    const custom = dialog.confirm({ confirmBtn: { content: '删除', disabled: true }, cancelBtn: '暂不删除' });
    assert.equal(component.data.confirmBtn.content, '确定');
    assert.equal(component.data.confirmBtn.disabled, true);
    assert.equal(component.data.cancelBtn, '取消');
    component._onConfirm();
    await custom;
  }
  const alert = dialog.alert({ content: '请选择订单' });
  if (file === 'miniprogram/pages/_shared/frontend/order/utils/dialog.ts') {
    assert.equal(component.data.confirmBtn.content, '确定');
    assert.equal(component.data.cancelBtn, null, 'single-button alerts must not render an empty cancel button');
  }
  component._onConfirm();
  await alert;
  if (file === 'miniprogram/pages/_shared/frontend/order/utils/dialog.ts') {
    const logisticsAlert = dialog.alert({ title: '物流查询失败', confirmBtn: '确认' });
    assert.equal(component.data.confirmBtn.content, '确认');
    assert.equal(component.data.cancelBtn, null, 'the confirm button occupies the full footer');
    assert.equal(component.data.content, '');
    component._onConfirm();
    await logisticsAlert;
    const copyAlert = dialog.alert({
      title: '物流查询失败', content: '可以手动粘贴到其他小程序查询', confirmBtn: null,
      actions: [{ content: '复制物流号', variant: 'text' }, { content: '确认', variant: 'text' }],
    });
    assert.equal(component.data.confirmBtn, null);
    assert.equal(component.data.cancelBtn, null);
    assert.equal(component.data.actions[0].content, '复制物流号');
    assert.equal(component.data.actions[1].content, '确认');
    component._onAction({ index: 0 });
    assert.equal((await copyAlert).index, 0);
  }
  await assert.rejects(dialog.confirm({ context: { selectComponent: () => null } }));
  return data;
}

async function run() {
  testAsyncComponents();
  await testAddressSelection();
  await testAddressEditDefaultSwitch();
  await dialogScenario('miniprogram/pages/_shared/frontend/order/utils/dialog.ts');
  console.log('PASS subpackage Dialog native confirm/cancel/alert actions preserve promises and button state');
  const order = load('miniprogram/services/order/utils/format.ts');
  const goods = load('miniprogram/services/goods/utils/formatTime.ts');
  for (const value of ['2026-10-05T04:00:00Z', 'invalid', '', null, 1791172800000, '1791172800000']) {
    assert.equal(order.formatTime(value, 'YYYY/MM/DD HH:mm:ss'), goods.formatTime(value, 'YYYY/MM/DD HH:mm:ss'));
  }
  assert.equal(order.priceFormat(12345, 2), '123.45');
  console.log('PASS split time and price utilities');
}

function testAsyncComponents() { require('./check-package-boundaries.cjs').check(); }
run().catch(error => { console.error(error); process.exitCode = 1; });
