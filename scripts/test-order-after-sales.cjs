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
mock('utils/api.ts', { request: async (action, payload) => { calls.push({ action, payload }); return response; }, getApiErrorMessage: (error) => error.message });
mock('utils/images.ts', { resolveImage: async (url) => url, resolveRightsImages: async (record) => record });
mock('pages/order/utils/dialog.ts', {});
mock('pages/order/components/reason-sheet/reasonSheet.ts', () => Promise.resolve([0]));
mock('pages/order/utils/format.ts', { formatTime: (time) => time, priceFormat: (amount) => (amount / 100).toFixed(2) });
const cache = new Map();
function load(file) {
  const filename = path.resolve(root, file);
  if (mocks.has(filename)) return mocks.get(filename);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'tdesign-miniprogram/toast/index') return () => {};
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Page: (definition) => { pageDefinition = definition; },
  }, { filename });
  return exports;
}

async function run() {
  const api = load('pages/order/apply-service/api.ts');
  await api.dispatchApplyService({
    rights: { orderNo: 'order-1', rightsType: 10, receiptStatus: 1, refundRequestAmount: 999, rightsReasonDesc: '质量问题', rightsImageUrls: [] },
    rightsItem: [{ skuId: 'sku-1', rightsQuantity: 1 }],
  });
  assert.equal(calls[0].payload.receiptStatus, 1);
  assert.equal(calls[0].payload.type, 10);
  assert.equal(Object.hasOwn(calls[0].payload, 'refundRequestAmount'), false, 'user does not decide refund amount');

  const { normalizeOrder } = load('pages/order/services/orderList.ts');
  const order = normalizeOrder({
    _id: 'order-1', status: 'refunded', items: [], addressSnapshot: {}, commentedProductIds: [], pendingRefundAmount: 0,
  });
  assert.equal(order.orderStatus, 60);
  assert.equal(order.orderStatusName, '已退款');

  const { normalizeRecord, getRightsList } = load('pages/order/after-service-list/api.ts');
  const rejected = normalizeRecord({
    _id: 'as-1', status: 'rejected', type: 20, description: '质量问题', reviewReason: '超过售后期', items: [], amount: 50,
  });
  assert.equal(rejected.rights.userRightsStatusDesc, '驳回原因：超过售后期');
  assert.equal(normalizeRecord({ _id: 'as-2', status: 'approved', type: 10, description: '质量问题', items: [] }).rights.userRightsStatusDesc, '审核通过，请填写退货物流');
  response = { items: [], total: 0, page: 1, pageSize: 10 };
  await getRightsList({ parameter: { afterServiceStatus: 60, pageNum: 1, pageSize: 10 } });
  assert.equal(calls.at(-1).payload.status, 'closed');

  load('pages/order/apply-service/index.ts');
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
