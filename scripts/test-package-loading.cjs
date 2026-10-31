const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../miniprogram');
const tick = () => new Promise(resolve => setImmediate(resolve));
function runtime(wx, asyncLoad, registrations = {}) {
  const cache = new Map();
  function load(file) {
    let absolute = path.resolve(root, file);
    if (!path.extname(absolute)) absolute += '.ts';
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {}; cache.set(absolute, exports);
    const localRequire = ref => ref.endsWith('/common/ui/toast') ? { default() {} } : load(path.resolve(path.dirname(absolute), ref));
    localRequire.async = ref => asyncLoad ? asyncLoad(ref, absolute, load) : Promise.resolve(load(path.resolve(path.dirname(absolute), ref)));
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, require: localRequire, console, wx, Promise, setTimeout, clearTimeout, ...registrations }, { filename: absolute });
    return exports;
  }
  return load;
}
async function testNativeTabs() {
  const requests = [], downloads = [], navigation = [];
  const query = { in() { return this; }, select() { return this; }, boundingClientRect(callback) { callback({ height: 88 }); return this; }, exec() {} };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 26, left: 281, right: 368, height: 32 }),
    getStorageSync: () => '', createSelectorQuery: () => query,
    showToast() {}, stopPullDownRefresh() {}, navigateTo({ url }) { navigation.push(url); },
    request({ data, success }) {
      requests.push(data.action);
      success({ statusCode: 200, data: { ok: true, data: { items: [], total: 0, config: {}, productsById: {} } } });
    },
    cloud: { async callFunction({ data }) {
      requests.push(data.action);
      return { result: { ok: true, data: { items: [], total: 0, config: {}, productsById: {} } } };
    } },
  };
  let definition;
  const load = runtime(wx, (ref, from, loadModule) => { downloads.push(ref); return Promise.resolve(loadModule(path.resolve(path.dirname(from), ref))); }, { Page(value) { definition = value; } });
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  for (const route of app.pages) {
    load(route + '.ts');
    let tabInitializations = 0;
    const page = { ...definition, data: structuredClone(definition.data),
      setData(value, done) { Object.assign(this.data, value); done?.(); },
      createSelectorQuery: () => query,
      getTabBar: () => ({ init() { tabInitializations++; } }),
    };
    page.onLoad?.({}); page.onShow?.(); page.onReady?.();
    await tick(); await tick();
    assert.equal(tabInitializations, 1, `${route}: selected tab`);
    assert.ok(!page.data.loadError && !page.data.cartLoadError && !page.data.categoryError, `${route}: initial load`);
    assert.equal(page.data.mountContent, undefined, 'native pages have no async UI shell');
    if (route.includes('usercenter')) { page.jumpAllOrder(); page.onClickCell({ currentTarget: { dataset: { type: 'address' } } }); }
  }
  for (const action of ['home.get', 'categories.list', 'cart.get', 'orders.count', 'afterSales.list']) assert.ok(requests.includes(action), action);
  assert.deepEqual(downloads, ['../../services/index'], 'tab scripts share one services download without importing pages or utils');
  assert.deepEqual(navigation, ['/pages/order/order-list/index', '/pages/user/address/list/index']);
  console.log('PASS all four native Tab pages load data, initialize navigation and share only the services package');
}
async function testProductListBridge() {
  assert.equal(fs.existsSync(path.join(root, 'common/services/good/fetchGoodsList.ts')), false, 'subpackage-only bridge must not ship in main');
  const requests = [];
  const response = { ok: true, data: { items: [], total: 0 } };
  const load = runtime({
    request({ data, success }) { requests.push(data); success({ statusCode: 200, data: response }); },
    cloud: { async callFunction({ data }) { requests.push(data); return { result: response }; } },
  });
  const list = await load('pages/goods/services/fetchGoodsList.ts').fetchGoodsList({ categoryId: 'test-category' });
  assert.equal(list.spuList.length, 0);
  assert.equal(requests[0].action, 'products.list');
  console.log('PASS goods-only list bridge loads services and fetches products outside main');
}

async function testServiceRetryAndCheckout() {
  let fail = true;
  const downloads = [];
  const load = runtime({}, (ref, from, loadModule) => {
    downloads.push(ref);
    if (fail) { fail = false; return Promise.reject(new Error('download failed')); }
    return Promise.resolve(loadModule(path.resolve(path.dirname(from), ref)));
  });
  const checkout = load('common/services/order/orderConfirm.ts');
  await assert.rejects(checkout.setPendingGoodsRequestList([{ skuId: 'one', quantity: 2 }]), /download failed/);
  await checkout.setPendingGoodsRequestList([{ skuId: 'one', quantity: 2 }]);
  const stored = await checkout.getPendingGoodsRequestList(); stored[0].quantity = 99;
  assert.equal((await checkout.getPendingGoodsRequestList())[0].quantity, 2);
  assert.deepEqual(downloads, ['../../services/index', '../../services/index']);
  await checkout.clearPendingGoodsRequestList();
  assert.equal(await checkout.getPendingGoodsRequestList(), null);

  let definition, completeDownload;
  const navigation = [];
  const cartLoad = runtime({ navigateTo({ url }) { navigation.push(url); } }, (ref, from, loadModule) => new Promise(resolve => { completeDownload = () => resolve(loadModule(path.resolve(path.dirname(from), ref))); }), { Page(value) { definition = value; } });
  cartLoad('tabs/cart/index.ts');
  const page = { ...definition, data: { cartGroupData: { storeGoods: [{ promotionGoodsList: [{ goodsPromotionList: [{ skuId: 'ordered', quantity: 3, isSelected: true }] }] }] } } };
  const pending = page.onToSettle(); await tick();
  assert.equal(navigation.length, 0, 'wait for service state before entering order package');
  completeDownload(); await pending;
  assert.deepEqual(navigation, ['/pages/order/order-confirm/index?type=cart']);
  assert.equal((await cartLoad('common/services/order/orderConfirm.ts').getPendingGoodsRequestList())[0].quantity, 3);
  console.log('PASS services download retry, immutable shared checkout state and cart navigation after state is saved');
}
async function testOrderViewEvents() {
  let pageDefinition, viewDefinition;
  const navigation = [], filters = [];
  const load = runtime({ navigateTo({ url }) { navigation.push(url); } }, null, {
    Page(value) { pageDefinition = value; }, Component(value) { viewDefinition = value; },
  });
  load('pages/order/order-list/index.ts');
  load('components/order/order-list-view/index.ts');
  const page = { ...pageDefinition, data: structuredClone(pageDefinition.data),
    setData(patch, done) { Object.assign(this.data, patch); done?.(); },
    refreshList(value) { filters.push(value); },
  };
  const handlers = { tabchange: 'onTabChange', cardtap: 'onOrderCardTap', refresh: 'onRefresh' };
  const view = { ...viewDefinition.methods, triggerEvent(name, detail) { page[handlers[name]]({ detail }); } };
  view.onTabChange({ detail: { value: 40 } });
  assert.equal(page.data.status, 40);
  assert.deepEqual(filters, [40]);
  view.onOrderCardTap({ currentTarget: { dataset: { order: { orderNo: 'view-test' } } } });
  assert.deepEqual(navigation, ['/pages/order/order-detail/index?orderNo=view-test']);
  page.data.orderList = [{ orderNo: 'view-test', goodsList: [], buttons: [] }];
  view.onRefresh({ detail: { action: 'confirmReceived', orderNo: 'view-test', order: { items: [] } } });
  assert.equal(page.data.orderList[0].status, 50);
  assert.equal(page.data.backRefresh, true);
  assert.deepEqual(filters, [40], 'receipt updates the card without discarding the current filter');
  console.log('PASS composed order view preserves filtering, detail navigation and receipt updates across the component boundary');
}
(async () => { await testNativeTabs(); await testProductListBridge(); await testServiceRetryAndCheckout(); await testOrderViewEvents(); })().catch(error => { console.error(error); process.exitCode = 1; });
