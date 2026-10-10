const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let pageDefinition, componentDefinition;
let confirmCalls = 0;
let confirmError;
let dialogCancelled = false;
const navigations = [];
const confirmedOrder = {
  _id: 'order-1', orderNo: 'order-1', status: 'received', commentedProductIds: [],
  items: [{ productId: 'product-1', skuId: 'sku-1', quantity: 2 }], refundedQuantities: { 'sku-1': 1 },
};
const mocks = new Map([
  ['config/navigation.ts', { isPageNavigationEnabled: () => true }],
  ['pages/order/utils/dialog.ts', { default: { confirm: async () => { if (dialogCancelled) throw new Error('cancel'); } } }],
  ['pages/order/services/orderDetail.ts', { confirmOrderReceived: async () => {
    confirmCalls++;
    if (confirmError) throw confirmError;
    return confirmedOrder;
  } }],
  ['pages/order/services/orderList.ts', {}],
  ['pages/order/utils/format.ts', { cosThumb: (value) => value }],
  ['pages/order/after-service-detail/api.ts', {}],
  ['services/cart/cart.ts', {}],
  ['utils/api.ts', { getApiErrorMessage: (error) => error.message }],
].map(([file, value]) => [path.resolve(root, file), value]));
function load(file) {
  const filename = path.resolve(root, file);
  if (mocks.has(filename)) return mocks.get(filename);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports,
    require(name) {
      if (name === 'tdesign-miniprogram/toast/index') return { default: () => {} };
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    },
    Page: (value) => { pageDefinition = value; },
    Component: (value) => { componentDefinition = value; },
    wx: { navigateTo: ({ url }) => navigations.push(url) },
  }, { filename });
  return exports;
}
async function run() {
  const { OrderStatus, OrderButtonTypes } = load('pages/order/config.ts');
  load('pages/order/order-list/index.ts');
  load('pages/order/components/order-button-bar/index.ts');
  const original = {
    id: 'order-1', orderNo: 'order-1', status: OrderStatus.PENDING_RECEIPT, statusDesc: '待收货', amount: 200,
    goodsList: [{ spuId: 'product-1', skuId: 'sku-1', num: 2, fulfillableQuantity: 1, title: '商品' }],
    buttons: [{ type: OrderButtonTypes.CONFIRM, name: '确认收货' }],
  };
  let listRefreshes = 0;
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, curTab: OrderStatus.PENDING_RECEIPT, status: OrderStatus.PENDING_RECEIPT, orderList: [original, { ...original, id: 'order-2', orderNo: 'order-2' }] },
    setData(patch, callback) { Object.assign(this.data, patch); callback?.(); },
    refreshList() { listRefreshes++; },
  };
  const events = [];
  const bar = {
    ...componentDefinition.methods,
    data: { currentOrder: original },
    triggerEvent(name, detail) { events.push({ name, detail }); page.onRefresh({ detail }); },
  };
  await bar.onConfirm(original);
  assert.equal(confirmCalls, 1);
  assert.equal(events[0].detail.action, 'confirmReceived');
  assert.equal(listRefreshes, 0, 'receipt must not reload the filtered list');
  assert.equal(page.data.orderList.length, 2);
  assert.equal(page.data.curTab, OrderStatus.PENDING_RECEIPT);
  assert.equal(page.data.status, OrderStatus.PENDING_RECEIPT);
  const completed = page.data.orderList[0];
  assert.equal(completed.status, OrderStatus.COMPLETE);
  assert.equal(completed.statusDesc, '已完成');
  assert.equal(completed.amount, original.amount);
  assert.equal(completed.commentableProductId, 'product-1');
  assert.equal(completed.buttons[0].type, OrderButtonTypes.COMMENT);
  assert(!completed.buttons.some((button) => button.type === OrderButtonTypes.CONFIRM));
  assert.equal(page.data.orderList[1].status, OrderStatus.PENDING_RECEIPT, 'other cards are unchanged');
  bar.onAddComment(completed);
  assert(navigations[0].includes('orderNo=order-1'));
  assert(navigations[0].includes('spuId=product-1'));

  page.onShow();
  assert.equal(listRefreshes, 0);
  page.onShow();
  assert.equal(listRefreshes, 1, 'returning to the page synchronizes the list');
  page.onRefresh();
  assert.equal(listRefreshes, 2, 'explicit refresh still synchronizes the list');
  page.onTabChange({ detail: { value: OrderStatus.COMPLETE } });
  assert.equal(listRefreshes, 3, 'changing filters still reloads the list');

  page.onRefresh({ detail: { action: 'confirmReceived', orderNo: 'order-1', order: { ...confirmedOrder, commentedProductIds: ['product-1'] } } });
  assert.equal(page.data.orderList[0].buttons[0].type, OrderButtonTypes.VIEW_COMMENT);
  const eventCount = events.length;
  confirmError = new Error('receipt failed');
  await bar.onConfirm(original);
  assert.equal(events.length, eventCount, 'failed confirmation must not change the card');
  dialogCancelled = true;
  await bar.onConfirm(original);
  assert.equal(confirmCalls, 2, 'cancelled dialogs must not submit confirmation');
  assert.equal(events.length, eventCount);
  console.log('PASS receipt updates only the current card, preserves filters and evaluation navigation, and defers list synchronization');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
