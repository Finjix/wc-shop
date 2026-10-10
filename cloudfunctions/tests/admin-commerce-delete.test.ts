// @ts-nocheck
const assert = require('assert');
const { makeRuntime } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');

const user = { auth: { uid: 'user-1' } };
const admin = { auth: { uid: 'admin-1' } };
const errorCode = (code) => (error) => error?.code === code;

async function run() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'admin-delete', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const payload = { type: 20, receiptStatus: 2, reason: '取消订单' };
  const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', { ...payload, orderId: order._id });
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.delete', { id: claim._id }), errorCode('ORDER_STATE_INVALID'));
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 100);
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'rejected', reason: '拒绝' });
  await adminEndpoint({}, admin, runtime, 'afterSales.delete', { id: claim._id });
  await adminEndpoint({}, admin, runtime, 'afterSales.delete', { id: claim._id });
  assert.strictEqual(runtime.records.afterSales[claim._id], undefined);
  assert.deepStrictEqual(runtime.records.orders[order._id].afterSaleIds, []);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 0);
  assert.strictEqual((await adminEndpoint({}, admin, runtime, 'afterSales.list', {})).total, 0);
  assert.strictEqual((await shopEndpoint({}, user, runtime, 'afterSales.list', {})).total, 0);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.detail', { afterSaleId: claim._id }), errorCode('NOT_FOUND'));
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.reapply', { ...payload, afterSaleId: claim._id }), errorCode('NOT_FOUND'));

  const next = await shopEndpoint({}, user, runtime, 'afterSales.create', { ...payload, orderId: order._id });
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: next._id, status: 'approved' });
  const orderSnapshot = { ...runtime.records.orders[order._id] };
  const stockBefore = runtime.records.skus['sku-new'].stockQuantity;
  // A historical related claim absent from the order's index must also be removed.
  runtime.records.afterSales.history = { ...claim, _id: 'history', status: 'rejected', deletedByAdmin: true };
  await adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: order._id });
  await adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: order._id });
  assert.strictEqual(runtime.records.orders[order._id], undefined);
  assert.strictEqual(runtime.records.afterSales[next._id], undefined);
  assert.strictEqual(runtime.records.afterSales.history, undefined);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stockBefore, 'deletion must not execute a refund or restock again');
  assert.strictEqual((await shopEndpoint({}, user, runtime, 'orders.list', {})).total, 0);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'orders.detail', { orderId: order._id }), errorCode('NOT_FOUND'));
  for (const fallback of [false, true]) {
    if (fallback) delete runtime.db.command.neq;
    for (const groupBy of [undefined, 'address']) {
      const orders = await adminEndpoint({}, admin, runtime, 'orders.list', { groupBy, status: 'cancelled' });
      assert.strictEqual(orders.total, 0);
      assert.strictEqual(orders.items.length, 0);
    }
    const claims = await adminEndpoint({}, admin, runtime, 'afterSales.list', { status: 'refunded' });
    assert.strictEqual(claims.total, 0);
    assert.strictEqual(claims.items.length, 0);
    const summary = await adminEndpoint({}, admin, runtime, 'dashboard.summary', {});
    assert.strictEqual(summary.metrics.orderCount, 0);
    assert.strictEqual(summary.metrics.afterSaleCount, 0);
  }
  // Previously soft-deleted rows can now be listed and permanently deleted.
  runtime.records.orders.archived = { ...orderSnapshot, _id: 'archived', afterSaleIds: [], deletedByAdmin: true };
  assert.strictEqual((await adminEndpoint({}, admin, runtime, 'orders.list', {})).total, 1);
  await adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: 'archived' });
  assert.strictEqual(runtime.records.orders.archived, undefined);
  // Linked in-progress claims prevent deletion even when a legacy aggregate is stale.
  runtime.records.orders.active = { ...orderSnapshot, _id: 'active', status: 'received', afterSaleIds: ['pending'], pendingRefundAmount: 0 };
  runtime.records.afterSales.pending = { ...claim, _id: 'pending', orderId: 'active', status: 'pending_review' };
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'orders.delete', { orderId: 'active' }), errorCode('ORDER_STATE_INVALID'));
  assert(runtime.records.orders.active);
  assert(runtime.records.afterSales.pending);
  console.log('PASS permanent commerce deletion, cascade, index cleanup, both clients and active-state guards');
}
module.exports = { run };
