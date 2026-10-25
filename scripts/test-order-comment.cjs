const { readSource: readMiniProgramSource } = require('./miniprogram-test-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let definition;
let currentPages = [];
let submitCalls = 0;
let submitError;
let backCalls = 0;
const timers = [];
const mocks = new Map([
  ['miniprogram/services/utils/api.ts', { getApiErrorMessage: (error) => error.message }],
  ['miniprogram/services/utils/images.ts', { resolveImage: async (value) => value }],
  ['miniprogram/common/utils/goods-detail-navigation.ts', {}],
  ['miniprogram/services/order/services/orderList.ts', {}],
  ['miniprogram/services/order/services/orderDetail.ts', {}],
  ['miniprogram/services/order/utils/format.ts', { cosThumb: (value) => value, formatTime: () => '' }],
  ['miniprogram/services/goods/services/comments/createComment.ts', { createComment: async () => {
    submitCalls++;
    if (submitError) throw submitError;
    return { orderNo: 'order-1', productId: 'product-1' };
  } }],
].map(([file, exports]) => [path.resolve(root, file), exports]));
function load(file) {
  const filename = require("./miniprogram-test-source.cjs").resolveSource(path.resolve(root, file));
  if (mocks.has(filename)) return mocks.get(filename);
  if (filename === path.join(root, 'miniprogram/order/utils/dialog.ts')) return { default: { alert: async () => {}, confirm: async () => {} } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readMiniProgramSource(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports,
    require(name) {
      name = name.replace(/^.*\/tdesign\//, "tdesign-miniprogram/");
      if (name === 'tdesign-miniprogram/toast/index') return { default() {} };
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    },
    Page(value) { definition = value; },
    wx: { navigateBack() { backCalls++; } },
    getCurrentPages: () => currentPages,
    setTimeout: (callback) => timers.push(callback),
    console,
  }, { filename });
  return exports;
}
function instance(file) {
  load(file);
  return { ...definition, data: { ...definition.data }, setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
}
async function run() {
  const { OrderStatus, OrderButtonTypes } = load('miniprogram/order/config.ts');
  const original = {
    id: 'order-1', orderNo: 'order-1', status: OrderStatus.COMPLETE, statusDesc: '已完成', amount: 200,
    commentedProductIds: [], commentableProductId: 'product-1',
    goodsList: [{ spuId: 'product-1', skuId: 'sku-1', num: 2, fulfillableQuantity: 1 }],
    buttons: [{ type: OrderButtonTypes.COMMENT, name: '评价', primary: true }],
  };
  let refreshes = 0;
  const list = instance('miniprogram/order/order-list/index.ts');
  list.hasShownOnce = true;
  list.page = { size: 5, num: 3 };
  Object.assign(list.data, { curTab: OrderStatus.COMPLETE, status: OrderStatus.COMPLETE, pendingCommentOnly: true, orderList: [original, { ...original, orderNo: 'order-2' }] });
  list.refreshList = () => { refreshes++; };
  const create = instance('miniprogram/goods/comments/create/index.ts');
  create.orderNo = 'order-1'; create.productId = 'product-1'; create.textAreaValue = '好评';
  create.data.isAllowedSubmit = true;
  currentPages = [list, create];
  create.onSubmitBtnClick();
  create.onSubmitBtnClick();
  await create.commentSubmitPromise;
  assert.equal(submitCalls, 1, 'prevent duplicate submits');
  assert.equal(refreshes, 0);
  assert.equal(backCalls, 0, 'keep the success toast delay');
  timers.shift()();
  list.onShow();
  assert.equal(backCalls, 1);
  assert.equal(refreshes, 0, 'returning from review must not reload the filter');
  assert.equal(list.data.orderList.length, 2, 'keep the completed card in pending-review filter');
  assert.equal(list.data.orderList[0].buttons[0].type, OrderButtonTypes.VIEW_COMMENT);
  assert.equal(list.data.orderList[1].buttons[0].type, OrderButtonTypes.COMMENT);
  assert.equal(list.data.curTab, OrderStatus.COMPLETE);
  assert.equal(list.data.pendingCommentOnly, true);
  assert.equal(list.page.num, 3, 'preserve pagination');
  list.onShow();
  assert.equal(refreshes, 1, 'only skip the immediate return');
  list.onTabChange({ detail: { value: -1 } });
  assert.equal(refreshes, 2, 'explicit tab changes still reload');

  const { applyCommentToOrder } = load('miniprogram/order/utils/comment-state.ts');
  const multi = applyCommentToOrder({ ...original, goodsList: [
    ...original.goodsList, { spuId: 'product-2', fulfillableQuantity: 1 }, { spuId: 'refunded', fulfillableQuantity: 0 },
  ] }, 'product-1');
  assert.equal(multi.commentableProductId, 'product-2');
  assert.equal(multi.buttons[0].type, OrderButtonTypes.COMMENT);
  const completed = applyCommentToOrder(multi, 'product-2');
  assert.equal(completed.buttons[0].type, OrderButtonTypes.VIEW_COMMENT);
  assert.equal(completed.hasPendingComments, false);

  const detail = instance('miniprogram/order/order-detail/index.ts');
  detail.hasShownOnce = true;
  detail.data._order = original;
  detail.data.order = { commentedProductIds: [], hasPendingComments: true };
  let detailRefreshes = 0;
  detail.onRefresh = () => { detailRefreshes++; };
  const fromDetail = instance('miniprogram/goods/comments/create/index.ts');
  fromDetail.orderNo = 'order-1'; fromDetail.productId = 'product-1'; fromDetail.data.isAllowedSubmit = true;
  currentPages = [list, detail, fromDetail];
  fromDetail.onSubmitBtnClick();
  await fromDetail.commentSubmitPromise;
  timers.shift()();
  detail.onShow();
  list.onShow();
  assert.equal(detailRefreshes, 0);
  assert.equal(refreshes, 2, 'patch the hidden list too when reviewing from detail');
  assert.equal(detail.data._order.buttons[0].type, OrderButtonTypes.VIEW_COMMENT);
  assert.equal(detail.data.order.hasPendingComments, false);

  const failed = instance('miniprogram/goods/comments/create/index.ts');
  failed.orderNo = 'order-2'; failed.productId = 'product-1'; failed.data.isAllowedSubmit = true;
  currentPages = [list, failed];
  submitError = new Error('提交失败');
  failed.onSubmitBtnClick();
  await failed.commentSubmitPromise;
  assert.equal(list.data.orderList[1].buttons[0].type, OrderButtonTypes.COMMENT);
  assert.equal(timers.length, 0);
  assert.equal(failed.data.submitting, false);
  console.log('PASS successful reviews patch cards without refreshing; preserve filters/pagination, multi-product eligibility, detail navigation and failure handling');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
