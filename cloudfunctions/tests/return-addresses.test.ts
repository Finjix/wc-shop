// @ts-nocheck
const assert = require('assert');
const { makeRuntime, localAddress } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');

async function run() {
  const runtime = makeRuntime();
  const user = { auth: { uid: 'user-1' } };
  const admin = (action, data = {}) => adminEndpoint({}, {}, runtime, action, data);
  const shop = (action, data) => shopEndpoint({}, user, runtime, action, data);
  const code = (value) => (err) => err.code === value;
  assert.deepStrictEqual((await admin('returnAddresses.list')).items, []);
  for (const invalid of [{}, { receiver: '商家', phone: 123, detail: '测试仓' }]) {
    await assert.rejects(() => admin('returnAddresses.save', invalid), code('INVALID_ARGUMENT'));
  }
  for (const freeText of [{ receiver: '', phone: '', detail: '' }, { receiver: 'x'.repeat(60), phone: '联系仓库客服', detail: '任意地址内容' }]) {
    const saved = await admin('returnAddresses.save', freeText);
    assert.strictEqual(saved.phone, freeText.phone);
    await admin('returnAddresses.delete', { id: saved._id });
  }
  const first = await admin('returnAddresses.save', { receiver: '一号仓', phone: '13800000000', detail: ' 广东省深圳市南山区测试一号仓 ' });
  const second = await admin('returnAddresses.save', { receiver: '二号仓', phone: '0755-12345678', detail: '广东省深圳市福田区测试二号仓' });
  assert.notStrictEqual(first._id, second._id);
  assert.strictEqual(first.receiver, '一号仓');
  assert.strictEqual((await admin('returnAddresses.list')).items.length, 2);
  await admin('settings.upsert', { key: 'global', value: { returnAddress: first } });
  await assert.rejects(() => admin('returnAddresses.save', { ...first, id: 'global' }), code('RETURN_ADDRESS_REQUIRED'));
  await assert.rejects(() => admin('returnAddresses.delete', { id: 'global' }), code('RETURN_ADDRESS_REQUIRED'));
  for (const [index, selected] of [first, second].entries()) {
    const order = await shop('orders.create', { requestKey: `return-address-${index}`, addressId: 'address-1', address: localAddress, items: [{ skuId: 'sku-new', quantity: 1 }] });
    await admin('orders.ship', { orderId: order._id, trackingNo: `TEST-${index}` });
    const claim = await shop('afterSales.create', { orderId: order._id, type: 10, reason: '测试退货' });
    for (const returnAddressId of [undefined, 'global', 'missing-address']) {
      await assert.rejects(() => admin('afterSales.review', { id: claim._id, status: 'approved', type: 10, returnAddressId, returnAddressSnapshot: first }), code('RETURN_ADDRESS_REQUIRED'));
      assert.strictEqual(runtime.records.afterSales[claim._id].status, 'pending_review');
      assert.strictEqual(runtime.records.orders[order._id].refundAmount || 0, 0);
    }
    const before = runtime.records.skus['sku-new'].stockQuantity;
    const approved = await admin('afterSales.review', { id: claim._id, status: 'approved', type: 10, returnAddressId: selected._id, returnAddressSnapshot: { ...first, detail: '篡改地址' } });
    assert.deepStrictEqual(approved.returnAddressSnapshot, selected);
    assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, before);
    await admin('returnAddresses.save', { ...selected, id: selected._id, detail: '修改后的地址' });
    await admin('returnAddresses.delete', { id: selected._id });
    const retry = await admin('afterSales.review', { id: claim._id, status: 'approved', type: 10, returnAddressId: 'missing-address' });
    assert.deepStrictEqual(retry.returnAddressSnapshot, selected, 'repeated approval must preserve the original snapshot');
    assert.deepStrictEqual((await admin('afterSales.get', { id: claim._id })).returnAddressSnapshot, selected);
    assert.deepStrictEqual((await shop('afterSales.detail', { afterSaleId: claim._id })).returnAddressSnapshot, selected);
    await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'foreign' } }, runtime, 'afterSales.detail', { afterSaleId: claim._id }), code('FORBIDDEN'));
    await shop('afterSales.submitTracking', { afterSaleId: claim._id, trackingNo: `RETURN-${index}` });
    assert.deepStrictEqual((await shop('afterSales.detail', { afterSaleId: claim._id })).returnAddressSnapshot, selected);
  }
  assert.deepStrictEqual((await admin('returnAddresses.list')).items, []);
  const order = await shop('orders.create', { requestKey: 'refund-no-address', addressId: 'address-1', address: localAddress, items: [{ skuId: 'sku-new', quantity: 1 }] });
  const claim = await shop('afterSales.create', { orderId: order._id, type: 20, reason: '取消订单' });
  assert.strictEqual((await admin('afterSales.review', { id: claim._id, status: 'approved', type: 20 })).status, 'refunded');
  console.log('PASS merchant return addresses, selection validation, immutable snapshots and refund-only compatibility');
}
module.exports = { run };
