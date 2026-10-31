const { readSource: readMiniProgramSource } = require('./miniprogram-test-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const calls = [];
let response = {};
let pageDefinition;
const mocks = new Map();
const mock = (file, value) => mocks.set(path.resolve(root, file), value);
mock('miniprogram/services/utils/api.ts', { request: async (action, payload) => { calls.push({ action, payload }); return response; }, cleanupCloudFiles: async () => {}, getApiErrorMessage: (error) => error.message });
mock('miniprogram/services/utils/images.ts', { resolveImage: async (url) => url, resolveRightsImages: async (record) => record });
mock('miniprogram/components/_shared/frontend/order/utils/dialog.ts', {});
mock('miniprogram/common/utils/goods-detail-navigation.ts', { navigateToGoodsDetail: () => {} });
mock('miniprogram/components/order/reason-sheet/reasonSheet.ts', () => Promise.resolve([0]));
mock('miniprogram/services/order/utils/format.ts', { formatTime: (time) => time, priceFormat: (amount) => (amount / 100).toFixed(2) });
const cache = new Map();
function load(file) {
  const filename = require("./miniprogram-test-source.cjs").resolveSource(path.resolve(root, file));
  if (mocks.has(filename)) return mocks.get(filename);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const source = ts.transpileModule(readMiniProgramSource(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name.endsWith('/common/ui/toast')) name = 'native-toast';
      if (name === 'native-toast') return () => {};
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Page: (definition) => { pageDefinition = definition; },
  }, { filename });
  return exports;
}

async function run() {
  const api = load('miniprogram/services/order/apply-service/api.ts');
  await api.dispatchApplyService({
    rights: { orderNo: 'order-1', rightsType: 10, receiptStatus: 1, refundRequestAmount: 999, rightsReasonDesc: '质量问题', rightsImageUrls: [] },
    rightsItem: [{ skuId: 'sku-1', rightsQuantity: 1 }],
  });
  assert.equal(calls[0].payload.receiptStatus, 1);
  assert.equal(calls[0].payload.type, 10);
  assert.equal(Object.hasOwn(calls[0].payload, 'refundRequestAmount'), false, 'user does not decide refund amount');

  const { normalizeOrder } = load('miniprogram/services/order/services/orderList.ts');
  const order = normalizeOrder({
    _id: 'order-1', status: 'refunded', items: [], addressSnapshot: {}, commentedProductIds: [], pendingRefundAmount: 0,
  });
  assert.equal(order.orderStatus, 60);
  assert.equal(order.orderStatusName, '已退款');
  const cancelled = { _id: 'cancelled-order', status: 'refunded', closureScenario: 'cancel_order', items: [], addressSnapshot: {}, commentedProductIds: [], pendingRefundAmount: 0 };
  assert.equal(normalizeOrder(cancelled).buttonVOs.some(button => button.type === 13), true);
  assert.equal(normalizeOrder({ ...cancelled, activeAfterSaleCount: 1 }).buttonVOs.some(button => button.type === 13), false);
  assert.equal(normalizeOrder({ ...cancelled, closureScenario: 'return_goods', fulfillmentStatus: 'shipped' }).buttonVOs.some(button => button.type === 13), true);
  for (const hasPendingComments of [true, false]) {
    const base = { _id: 'received-order', status: 'received', items: [], addressSnapshot: {}, commentedProductIds: [], pendingRefundAmount: 0, hasPendingComments };
    const active = normalizeOrder({ ...base, activeAfterSaleCount: 1, afterSalesList: [{ _id: 'service-1', status: 'pending_review' }] });
    assert.equal(active.buttonVOs.some(button => [6, 10].includes(button.type)), false);
    assert.equal(active.buttonVOs.some(button => button.type === 12), true, 'withdrawal remains available');
    const normal = normalizeOrder({ ...base, activeAfterSaleCount: 0 });
    assert.equal(normal.buttonVOs.some(button => button.type === (hasPendingComments ? 6 : 10)), true);
  }

  const { normalizeRecord, getRightsList } = load('miniprogram/services/order/after-service-list/api.ts');
  const rejected = normalizeRecord({
    _id: 'as-1', status: 'rejected', type: 20, description: '质量问题', reviewReason: '超过售后期', items: [], amount: 50,
  });
  assert.equal(rejected.rights.userRightsStatusDesc, '驳回原因：超过售后期');
  const returnApproved = normalizeRecord({ _id: 'as-2', status: 'approved', type: 10, items: [] });
  assert.equal(returnApproved.rights.userRightsStatusName, '请按寄件地址退货并填写物流单号');
  assert.equal(returnApproved.rights.userRightsStatusDesc, returnApproved.rights.userRightsStatusName, 'approved returns have no extra status description');
  assert.equal(returnApproved.buttonVOs.find((button) => button.type === 3).name, '填写退货物流');
  assert.equal(returnApproved.buttonVOs.find((button) => button.type === 2).name, '撤销申请');
  const returnShipped = normalizeRecord({ _id: 'as-3', status: 'refunding', type: 10, trackingNo: 'SF001', items: [] });
  assert.equal(returnShipped.rights.userRightsStatusName, '等待商家收货并同意退款');
  assert.match(returnShipped.rights.userRightsStatusDesc, /退货物流已提交/);
  assert.equal(returnShipped.buttonVOs.some((button) => button.type === 2), false, 'tracking submission disables withdrawal');
  load('miniprogram/pages/order/after-service-list/index.ts');
  const listPage = { ...pageDefinition, page: { ...pageDefinition.page }, data: JSON.parse(JSON.stringify(pageDefinition.data)), setData(patch, done) { Object.assign(this.data, patch); done?.(); } };
  response = { items: [{ _id: 'waiting-return', status: 'approved', type: 10, items: [], amount: 100 }], total: 1, page: 1, pageSize: 10 };
  await listPage.getAfterServiceList();
  assert.equal(listPage.data.dataList[0].statusName, '待用户退货');
  assert.equal(returnApproved.rights.userRightsStatusName, '请按寄件地址退货并填写物流单号', 'the detail status keeps the full instructions');
  const { afterSalePolicy } = load('admin/src/lib/after-sale-policy.ts');
  const returnPolicy = afterSalePolicy({ scenario: 'after_sale', requestedType: 10, amount: 100 });
  assert.equal(returnPolicy.fixedType, null);
  assert.equal(JSON.stringify(returnPolicy.allowedTypes), '[10,20]');
  const cancellationPolicy = afterSalePolicy({ scenario: 'cancel_order', amount: 100 });
  assert.equal(cancellationPolicy.fixedType, 20);
  assert.equal(JSON.stringify(cancellationPolicy.allowedTypes), '[20]');
  assert.equal(cancellationPolicy.fullRefundOnly, true);
  const commerceSource = readMiniProgramSource(path.join(root, 'admin/src/pages/CommercePages.tsx'), 'utf8');
  assert.doesNotMatch(commerceSource, /本次仅同意退货申请/);
  assert.match(commerceSource, /!isReturnApproval && <label className="field"><span>退款金额（元）/);
  assert.match(commerceSource, /afterSaleId: afterSaleIdOf\(returnApproval\), amount: returnRefundAmount/);
  response = { items: [], total: 0, page: 1, pageSize: 10 };
  await getRightsList({ parameter: { afterServiceStatus: 60, pageNum: 1, pageSize: 10 } });
  assert.equal(calls.at(-1).payload.status, 'closed');

  load('miniprogram/pages/order/after-service-detail/index.ts');
  const detailDefinition = pageDefinition;
  for (const status of ['approved', 'pending_review', 'rejected', 'refunding', 'refunded']) {
    response = { _id: 'return-detail', status, type: 10, items: [], amount: 100, trackingNo: ['refunding', 'refunded'].includes(status) ? 'SF001' : '', returnAddressSnapshot: { receiver: '商家', phone: '13800000000', detail: '退货地址' } };
    const detailPage = { ...detailDefinition, rightsNo: 'return-detail', data: { ...detailDefinition.data }, setData(patch) { Object.assign(this.data, patch); } };
    await detailPage.getService();
    assert.equal(detailPage.data.service.bottomActions, ['approved', 'pending_review', 'rejected', 'refunding'].includes(status), 'return tracking edits, withdrawal and reapplication share the bottom action bar');
    if (status === 'approved') assert.equal(detailPage.data.service.statusName, '待用户退货');
    assert.equal(detailPage.data.service.showReturnInstructions, status === 'approved', 'only an approved return awaiting tracking needs sender-address instructions');
    assert.equal(detailPage.data.service.receiverAddress, undefined, 'legacy system return addresses are ignored');
    if (['refunding', 'refunded'].includes(status)) assert.equal(detailPage.data.service.logisticsNo, 'SF001');
  }
  const detailTemplate = readMiniProgramSource(path.join(root, 'miniprogram/pages/order/after-service-detail/index.wxml'), 'utf8');
  assert.doesNotMatch(detailTemplate, /name="location"/);
  assert.match(detailTemplate, /class="order-logistics" bindtap="onLogisticsTap"/);
  assert.match(detailTemplate, /<view>查看物流<\/view>/);
  assert.doesNotMatch(detailTemplate, /description="\{\{service.logisticsDescription\}\}"|service-detail__button-bar/);
  assert.match(detailTemplate, /wx:if="\{\{service.showReturnInstructions\}\}"/);
  assert.match(detailTemplate, /请按原包裹的寄件地址退货，并填写退货物流单号。/);
  assert.doesNotMatch(detailTemplate, /service.receiverAddress|service.receiverName|service.receiverPhone|onAddressCopy/);
  const applySource = readMiniProgramSource(path.join(root, 'miniprogram/pages/order/apply-service/index.ts'), 'utf8');
  const applyTemplate = readMiniProgramSource(path.join(root, 'miniprogram/pages/order/apply-service/index.wxml'), 'utf8');
  assert.doesNotMatch(applySource + applyTemplate, /returnAddressConfigured|returnAddressMissing|hasReturnAddress|商家尚未配置退货地址/);
  assert.match(applyTemplate, /请按原包裹的寄件地址退货/);
  assert.doesNotMatch(commerceSource, /售后地址设置|export function SettingsPage/);

  const trackingApi = load('miniprogram/services/order/fill-tracking-no/api.ts');
  await trackingApi.create({ afterSaleId: 'return-detail', trackingNo: 'SF001', remark: '易碎物品' });
  assert.equal(calls.at(-1).action, 'afterSales.submitTracking');
  assert.equal(calls.at(-1).payload.trackingNo, 'SF001');
  assert.equal(Object.hasOwn(calls.at(-1).payload, 'remark'), false, 'tracking form no longer submits a remark');
  assert.equal(Object.hasOwn(calls.at(-1).payload, 'logisticsCompanyName'), false);
  load('miniprogram/pages/order/fill-tracking-no/index.ts');
  const trackingPage = { ...pageDefinition, data: { ...pageDefinition.data }, setData(patch) { Object.assign(this.data, patch); } };
  trackingPage.onLoad({ rightsNo: 'return-detail', logisticsNo: 'SF001' });
  assert.equal(trackingPage.data.submitActived, true);
  trackingPage.data.trackingNo = '   ';
  assert.equal(trackingPage.checkParams(), false);
  trackingPage.data.trackingNo = 'SF002';
  assert.equal(trackingPage.checkParams(), true, 'tracking number alone enables saving');
  const trackingTemplate = readMiniProgramSource(path.join(root, 'miniprogram/pages/order/fill-tracking-no/index.wxml'), 'utf8');
  assert.doesNotMatch(trackingTemplate, /notice-bar|物流公司/);
  assert.doesNotMatch(trackingTemplate, /备注|t-textarea/);

  load('miniprogram/pages/order/apply-service/index.ts');
  const definition = pageDefinition;
  for (const [status, receipt, showRefundType] of [[10, 2, false], [40, 1, true], [50, 1, true]]) {
    const page = {
      ...definition,
      query: { orderStatus: status },
      data: { ...definition.data, showRefundType },
      refresh: async () => {},
      setData(patch) {
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'serviceFrom.receiptStatus') this.data.serviceFrom = { ...this.data.serviceFrom, receiptStatus: value };
          else this.data[key] = value;
        }
      },
    };
    await page.init();
    assert.equal(page.data.serviceFrom.receiptStatus.status, receipt);
    if (showRefundType) assert.equal(page.data.serviceType, 10);
  }

  const { parseRefundAmount } = load('admin/src/lib/refund-amount.ts');
  assert.equal(parseRefundAmount('0.29', 100), 29);
  assert.equal(parseRefundAmount('1', 100), 100);
  assert.equal(parseRefundAmount('1.00', 100), 100);
  for (const value of ['0', '-1', '1.01', '0.001', '1e-2', '', 'NaN', '99999999999999999999']) {
    assert.equal(parseRefundAmount(value, 100), null);
  }
  console.log('PASS order refund state, merchant amount parsing, receipt defaults/payload, rejection reasons and closed filter');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
