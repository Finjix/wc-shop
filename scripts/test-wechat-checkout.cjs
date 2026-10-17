const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

async function run() {
  const file = path.join(__dirname, '../packages/api/services/order/orderConfirm.ts');
  const code = ts.transpile(fs.readFileSync(file, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  const calls = []; let paymentCalls = 0, cancelled = false, state = 'unpaid';
  const module = { exports: {} };
  const paid = { _id: 'order-1', orderNo: 'order-1', checkoutId: 'checkout-1', status: 'paid', paymentStatus: 'paid', payment: { mode: 'wechat', status: 'paid' }, totalAmount: 100 };
  const api = { request: async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'orders.create') return { _id: 'order-1', checkoutId: 'checkout-1', paymentRequired: true };
    if (action === 'orders.pay') return { payment: { package: 'prepay_id=verified', timeStamp: '123', nonceStr: 'nonce', paySign: 'signature', signType: 'RSA' } };
    if (action === 'orders.checkout') return state === 'paid' ? paid : { paymentStatus: 'unpaid' };
    throw new Error(action);
  } };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    if (id === '../../utils/api') return api;
    if (id === '../address/fetchAddress') return { toOrderAddress: (value) => value };
    throw new Error(id);
  }, wx: { requestPayment: (options) => {
    paymentCalls += 1;
    assert.equal(options.package, 'prepay_id=verified');
    if (cancelled) options.fail({ errMsg: 'requestPayment:fail cancel' }); else options.success({});
  } }, setTimeout: (fn) => fn() }, { filename: file });
  const params = { requestKey: 'stable-key', goodsRequestList: [{ skuId: 'sku', quantity: 1 }], address: { receiver: '测试', phone: '13800000000', detail: '测试地址' } };
  cancelled = true;
  await assert.rejects(() => module.exports.createOrder(params), (e) => e.code === 'PAYMENT_CANCELLED');
  assert.ok(!calls.some(([action]) => action === 'orders.checkout'));
  cancelled = false;
  await assert.rejects(() => module.exports.payCheckout('checkout-1'), (e) => e.code === 'PAYMENT_CONFIRMING');
  assert.equal(calls.filter(([action]) => action === 'orders.checkout').length, 5);
  state = 'paid';
  const result = await module.exports.payCheckout('checkout-1');
  assert.equal(result.data.orderStatus, 10);
  assert.equal(result.data.paymentStatus, 'paid');
  assert.equal(paymentCalls, 3);
  assert.ok(calls.filter(([action]) => action === 'orders.pay').every(([, data]) => Object.keys(data).join(',') === 'checkoutId'));
  console.log('PASS WeChat checkout cancellation, server confirmation, bounded polling and retry without duplicate order creation');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
