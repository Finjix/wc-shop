// @ts-nocheck
const assert = require('assert');
const { makeRuntime } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const { SCENARIOS, scenarioOf, presentAfterSale } = require('../shared/after-sale-policy');

const user = { auth: { uid: 'user-1' } };
const admin = { auth: { uid: 'admin-1' } };
const errorCode = (code) => (error) => error?.code === code;

async function run() {
  assert.strictEqual(scenarioOf({ orderStatusAtApply: 'paid' }), SCENARIOS.CANCEL_ORDER);
  assert.strictEqual(scenarioOf({ scenario: 'after_sale', orderStatusAtApply: 'paid' }), SCENARIOS.AFTER_SALE);
  assert.strictEqual(scenarioOf({ receiptStatus: 2 }), SCENARIOS.AFTER_SALE, 'unknown history must not be inferred from receipt status');
  const legacy = presentAfterSale({ orderStatusAtApply: 'paid', status: 'rejected', amount: 100 });
  assert.strictEqual(legacy.presentation.typeLabel, '取消订单');
  assert.strictEqual(legacy.presentation.receiptStatusLabel, '未发货');
  assert.deepStrictEqual(legacy.actions, { withdraw: false, reapply: true, countInBadge: false });

  for (const status of ['refunded', 'rejected', 'withdrawn']) {
    assert.strictEqual(presentAfterSale({ status }).actions.countInBadge, false);
  }
  for (const status of ['pending_review', 'approved', 'refunding']) {
    assert.strictEqual(presentAfterSale({ status }).actions.countInBadge, true);
  }

  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'scenario-cancel', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const preview = await shopEndpoint({}, user, runtime, 'afterSales.preview', { orderId: order._id });
  assert.strictEqual(preview.scenario, SCENARIOS.CANCEL_ORDER);
  assert.deepStrictEqual(preview.allowedTypes, [20]);
  assert.strictEqual(preview.applicationPolicy.defaultReason, '取消订单');
  const payload = { type: 20, receiptStatus: 2, reason: '取消订单' };
  const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', { ...payload, orderId: order._id, scenario: 'after_sale' });
  assert.strictEqual(claim.scenario, SCENARIOS.CANCEL_ORDER, 'scene must be derived by server, not trusted from client');
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'rejected', reason: '请补充原因' });
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 0);
  const rejected = await adminEndpoint({}, admin, runtime, 'afterSales.get', { id: claim._id });
  assert.strictEqual(rejected.actions.reapply, true);
  assert.strictEqual(rejected.reviewPolicy.fullRefundOnly, true);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.create', { ...payload, orderId: order._id, reapplyId: claim._id }), errorCode('INVALID_ARGUMENT'));
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'foreign' } }, runtime, 'afterSales.reapply', { ...payload, afterSaleId: claim._id }), errorCode('FORBIDDEN'));
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.reapply', { ...payload, type: 10, afterSaleId: claim._id }), errorCode('ORDER_STATE_INVALID'));
  assert.strictEqual(runtime.records.afterSales[claim._id].status, 'rejected');
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 0);
  const attempts = await Promise.allSettled([
    shopEndpoint({}, user, runtime, 'afterSales.reapply', { ...payload, afterSaleId: claim._id }),
    shopEndpoint({}, user, runtime, 'afterSales.reapply', { ...payload, afterSaleId: claim._id }),
  ]);
  assert.strictEqual(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1, 'concurrent retries may reserve only once');
  const reapplied = attempts.find((attempt) => attempt.status === 'fulfilled').value;
  assert.strictEqual(reapplied._id, claim._id);
  assert.strictEqual(reapplied.status, 'pending_review');
  assert.strictEqual(reapplied.reviewReason, undefined);
  assert.strictEqual(reapplied.reviewedAt, undefined);
  assert.strictEqual(Object.keys(runtime.records.afterSales).length, 1);
  assert.deepStrictEqual(runtime.records.orders[order._id].afterSaleIds, [claim._id]);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 100);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'orders.delete', { orderId: order._id }), errorCode('ORDER_STATE_INVALID'));
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.reapply', { ...payload, afterSaleId: claim._id }), errorCode('ORDER_STATE_INVALID'));
  const listing = await adminEndpoint({}, admin, runtime, 'afterSales.list', {});
  assert.strictEqual(listing.items[0].presentation.typeLabel, '取消订单');
  // A stale or tampered client cannot turn cancellation into a return or partial refund.
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved', type: 10, amount: 100 }), errorCode('ORDER_STATE_INVALID'));
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved', type: 20, amount: 1 }), errorCode('INVALID_ARGUMENT'));
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  assert.strictEqual(runtime.records.afterSales[claim._id].type, 20);
  assert.strictEqual(runtime.records.afterSales[claim._id].amount, 100);
  assert.strictEqual(runtime.records.orders[order._id].refundAmount, 100);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 0);
  assert.strictEqual(runtime.records.orders[order._id].closureScenario, 'cancel_order');
  await shopEndpoint({}, user, runtime, 'orders.delete', { orderId: order._id });
  assert.strictEqual(runtime.records.orders[order._id].deletedByUser, true);
  assert.strictEqual(runtime.records.afterSales[claim._id].amount, 100, 'deletion must retain financial history');
  const visible = await shopEndpoint({}, user, runtime, 'orders.list', { page: 1, pageSize: 20 });
  assert.ok(!visible.items.some((item) => item._id === order._id));

  const nextOrder = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'scenario-normal', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const second = await shopEndpoint({}, user, runtime, 'afterSales.create', { ...payload, orderId: nextOrder._id });
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: second._id, status: 'rejected', reason: '驳回' });
  await adminEndpoint({}, admin, runtime, 'orders.ship', { orderId: nextOrder._id, trackingNo: 'SF001' });
  const normal = await shopEndpoint({}, user, runtime, 'afterSales.reapply', { ...payload, afterSaleId: second._id });
  assert.strictEqual(normal.scenario, SCENARIOS.AFTER_SALE, 'reapply must use the latest fulfillment state');
  assert.strictEqual(normal.reviewPolicy.fullRefundOnly, false);
  assert.deepStrictEqual(normal.reviewPolicy.allowedTypes, [10, 20]);
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: normal._id, status: 'approved', type: 20, amount: 50 });
  assert.strictEqual(runtime.records.afterSales[normal._id].amount, 50, 'normal refunds must remain editable');
  assert.strictEqual(runtime.records.orders[nextOrder._id].closureScenario, 'after_sale');
  const cancelledDetail = await adminEndpoint({}, admin, runtime, 'orders.get', { orderId: order._id });
  assert.strictEqual(cancelledDetail.status, 'refunded', 'ledger state must remain unchanged');
  assert.strictEqual(cancelledDetail.displayStatus, 'cancelled');
  const refundedDetail = await adminEndpoint({}, admin, runtime, 'orders.get', { orderId: nextOrder._id });
  assert.strictEqual(refundedDetail.displayStatus, 'refunded');
  for (const fallback of [false, true]) {
    if (fallback) delete runtime.db.command.in;
    for (const groupBy of [undefined, 'address']) {
      const cancelled = await adminEndpoint({}, admin, runtime, 'orders.list', { status: 'cancelled', groupBy, page: 1, pageSize: 1 });
      const refunded = await adminEndpoint({}, admin, runtime, 'orders.list', { status: 'refunded', groupBy, page: 1, pageSize: 1 });
      const cancelRows = groupBy ? cancelled.items.flatMap((group) => group.orders) : cancelled.items;
      const refundRows = groupBy ? refunded.items.flatMap((group) => group.orders) : refunded.items;
      assert.deepStrictEqual(cancelRows.map((item) => item._id), [order._id]);
      assert.deepStrictEqual(refundRows.map((item) => item._id), [nextOrder._id]);
      assert.strictEqual(cancelled.total, 1);
      assert.strictEqual(refunded.total, 1);
    }
  }
  await shopEndpoint({}, user, runtime, 'orders.delete', { orderId: nextOrder._id });
  console.log('PASS after-sale scenarios, policies, reapplication, badge counts and terminal order deletion');
}
module.exports = { run };
