const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

function runtime(wx = {}, asyncLoad, registrations = {}) {
  const cache = new Map();
  function load(file) {
    let absolute = path.resolve(root, file);
    if (!path.extname(absolute)) absolute += '.ts';
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {};
    cache.set(absolute, exports);
    const localRequire = ref => ref.includes('/tdesign/toast/index') ? { default() {} } : load(path.resolve(path.dirname(absolute), ref));
    localRequire.async = ref => asyncLoad ? asyncLoad(ref, absolute, load) : Promise.resolve(load(path.resolve(path.dirname(absolute), ref)));
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, { exports, require: localRequire, console, wx, Promise, setTimeout, clearTimeout, ...registrations }, { filename: absolute });
    return exports;
  }
  return load;
}

async function testLoader() {
  const { createPackageLoader } = runtime()('common/package-loader.ts');
  let downloads = 0;
  let release;
  const load = createPackageLoader(() => {
    downloads++;
    return new Promise(resolve => { release = resolve; });
  });
  const first = load();
  assert.equal(load(), first);
  await tick();
  assert.equal(downloads, 1);
  release({ ready: true });
  assert.equal(await first, await load());
  let attempts = 0;
  const retry = createPackageLoader(async () => { if (++attempts === 1) throw new Error('offline'); return 'online'; });
  await assert.rejects(retry(), /offline/);
  assert.equal(await retry(), 'online');
  assert.equal(attempts, 2);
  console.log('PASS package loader shares concurrent/successful loads and retries rejected downloads');
}

async function testTabLifecycle() {
  let rejectDownload;
  let releaseDownload;
  let attempt = 0;
  const load = runtime({ stopPullDownRefresh() {} }, () => {
    attempt++;
    return new Promise((resolve, reject) => { releaseDownload = resolve; rejectDownload = reject; });
  });
  const { createTabPage } = load('common/tab-page.ts');
  const { tabContent } = load('packages/frontend/tab-content.ts');
  const calls = [];
  const definition = tabContent({
    data: {},
    onLoad(options) { calls.push(`load:${options.id}`); },
    onShow() { calls.push('show'); }, onHide() { calls.push('hide'); },
    onReady() { calls.push('ready'); }, onUnload() { calls.push('unload'); },
    refreshData(force) { calls.push(`refresh:${force}`); },
  });
  const component = { ...definition.methods, triggerEvent() { shell.onContentReady(); } };
  definition.lifetimes.attached.call(component);
  const shell = {
    ...createTabPage(), data: {},
    setData(patch) { Object.assign(this.data, patch); },
    getTabBar: () => ({ init() { calls.push('tab'); } }),
    selectComponent: () => component,
  };
  shell.onLoad({ id: 'first' }); shell.onShow(); shell.onHide(); shell.refreshData(false); shell.refreshData(true);
  await tick();
  rejectDownload(new Error('offline'));
  await tick();
  assert.ok(shell.data.packageError);
  shell.retryPackage(); await tick(); releaseDownload({ ready: true }); await tick();
  assert.equal(attempt, 2);
  assert.equal(shell.data.mountContent, true);
  definition.lifetimes.ready.call(component);
  assert.deepEqual(calls, ['tab','load:first','ready','refresh:true']);
  shell.onShow(); shell.onShow(); shell.onHide(); shell.onShow();
  assert.equal(calls.filter(call => call === 'show').length, 2);
  shell.onUnload(); definition.lifetimes.detached.call(component);
  assert.equal(calls.filter(call => call === 'unload').length, 1);
  shell.refreshData(true);
  assert.equal(calls.filter(call => call === 'refresh:true').length, 1);

  let finish;
  const closingLoad = runtime({}, () => new Promise(resolve => { finish = resolve; }));
  const closing = { ...closingLoad('common/tab-page.ts').createTabPage(), data: {}, setData(patch) { Object.assign(this.data, patch); } };
  closing.onLoad({}); await tick(); closing.onUnload(); finish({ ready: true }); await tick();
  assert.notEqual(closing.data.mountContent, true, 'closed page must not mount late content');
  console.log('PASS actual tab host lifecycle order, hidden first mount, queued refresh, failure/retry and unload races');
}

async function testApiBoundary() {
  const modules = [];
  const calls = [];
  let fail = true;
  const load = runtime({ cloud: { async callFunction(options) {
    calls.push(options.data);
    return { result: { ok: true, data: { items: [] } } };
  } } }, async (ref, from, loadModule) => {
    modules.push(ref);
    if (fail) { fail = false; throw new Error('download failed'); }
    return loadModule(path.resolve(path.dirname(from), ref));
  });
  const cart = load('packages/frontend/services/order/orderConfirm.ts');
  await assert.rejects(cart.setPendingGoodsRequestList([{ skuId: 'one', quantity: 2 }]), /download failed/);
  await cart.setPendingGoodsRequestList([{ skuId: 'one', quantity: 2 }]);
  assert.equal((await cart.getPendingGoodsRequestList())[0].quantity, 2);
  const stored = await cart.getPendingGoodsRequestList(); stored[0].quantity = 99;
  assert.equal((await cart.getPendingGoodsRequestList())[0].quantity, 2);
  const api = load('packages/frontend/utils/api.ts');
  await api.request('categories.list', { page: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scope, 'shop'); assert.equal(calls[0].action, 'categories.list');
  assert.equal(api.getApiErrorMessage(new Error('expected')), 'expected');
  await cart.clearPendingGoodsRequestList();
  assert.equal(await cart.getPendingGoodsRequestList(), null);
  assert.deepEqual(modules, ['../api/index','../api/index']);
  assert.ok(!modules.some(ref => ref.includes('plugins')));
  console.log('PASS actual frontend facade/api entry: retry, shared checkout state, unchanged request envelope and lazy plugins');
}

async function testCheckoutNavigationWaits() {
  let definition;
  let completeDownload;
  const navigation = [];
  const load = runtime({ navigateTo(options) { navigation.push(options.url); } }, (ref, from, loadModule) =>
    new Promise(resolve => { completeDownload = () => resolve(loadModule(path.resolve(path.dirname(from), ref))); }), {
      Component(value) { definition = value; },
    });
  load('packages/frontend/pages/cart/index.ts');
  const page = {
    ...definition.methods,
    data: { cartGroupData: { storeGoods: [{ promotionGoodsList: [{ goodsPromotionList: [{ skuId: 'ordered', quantity: 3, isSelected: true }] }] }] } },
  };
  const checkout = page.onToSettle();
  await tick();
  assert.equal(navigation.length, 0, 'navigation must wait for the API service state to be saved');
  completeDownload(); await checkout;
  assert.deepEqual(navigation, ['/packages/frontend/pages/order/order-confirm/index?type=cart']);
  const stored = await load('packages/frontend/services/order/orderConfirm.ts').getPendingGoodsRequestList();
  assert.equal(stored[0].skuId, 'ordered'); assert.equal(stored[0].quantity, 3);
  console.log('PASS actual cart callback awaits the async service/state before navigating to checkout');
}

(async () => { await testLoader(); await testTabLifecycle(); await testApiBoundary(); await testCheckoutNavigationWaits(); })().catch(error => { console.error(error); process.exitCode = 1; });
