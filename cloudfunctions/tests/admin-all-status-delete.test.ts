// @ts-nocheck
const assert = require('assert');
const { makeRuntime } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const user = { auth: { uid: 'user-1' } }, admin = { auth: { uid: 'admin-1' } };

async function run() {
  for (const state of ['paid', 'paid_pending', 'shipped', 'shipped_pending', 'received', 'completed', 'refunded', 'cancelled']) {
    const runtime = makeRuntime();
    runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
    const order = await shopEndpoint({}, user, runtime, 'orders.create', { requestKey: `delete-${state}`, addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }] });
    if (['shipped', 'shipped_pending', 'received', 'completed', 'refunded'].includes(state)) {
      await adminEndpoint({}, admin, runtime, 'orders.ship', { orderId: order._id, trackingNo: 'SF001' });
    }
    if (['received', 'completed'].includes(state)) await shopEndpoint({}, user, runtime, 'orders.confirmReceived', { orderId: order._id });
    if (state === 'completed') await adminEndpoint({}, admin, runtime, 'orders.updateStatus', { orderId: order._id, status: 'completed' });
    if (['paid_pending', 'shipped_pending', 'refunded', 'cancelled'].includes(state)) {
      const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 20, receiptStatus: 2, reason: '退款' });
      if (['refunded', 'cancelled'].includes(state)) await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
    }
    assert.strictEqual((await adminEndpoint({}, admin, runtime, 'orders.get', { orderId: order._id })).canDeleteAdmin, true);
    await adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: order._id });
    await adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: order._id });
    assert.strictEqual(runtime.records.orders[order._id], undefined, state);
    assert.strictEqual(Object.keys(runtime.records.afterSales).length, 0, state);
    const restored = ['paid', 'paid_pending', 'cancelled'].includes(state);
    assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, restored ? 10 : 9, `${state}: unshipped inventory must release exactly once; shipped inventory must not restock`);
    assert.strictEqual(runtime.records.skus['sku-new'].soldQuantity, restored ? 0 : 1, state);
    assert.strictEqual((await shopEndpoint({}, user, runtime, 'orders.list', {})).total, 0);
    assert.strictEqual((await shopEndpoint({}, user, runtime, 'afterSales.list', {})).total, 0);
  }
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', { requestKey: 'delete-partial-refund', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 2 }] });
  const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 20, reason: '取消一件', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }] });
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);
  await adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: order._id });
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10, 'already refunded quantity must not be restored again');
  assert.strictEqual(runtime.records.skus['sku-new'].soldQuantity, 0);
  console.log('PASS permanent deletion of every order state and safe unshipped inventory release');
}
module.exports = { run };
