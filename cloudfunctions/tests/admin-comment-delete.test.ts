// @ts-nocheck
const assert = require('assert');
const { makeRuntime } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const user = { auth: { uid: 'user-1' } };
const admin = { auth: { uid: 'admin-1' } };
const errorCode = (code) => (error) => error?.code === code;

async function fixture(status = 'pending_review') {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'comment-delete', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  await adminEndpoint({}, admin, runtime, 'orders.ship', { orderId: order._id, trackingNo: 'tracking' });
  await shopEndpoint({}, user, runtime, 'orders.confirmReceived', { orderId: order._id });
  const comment = await shopEndpoint({}, user, runtime, 'comments.create', {
    orderId: order._id, productId: 'product-1', content: '评价', rating: 5,
    images: ['cloud://test/user/comments/review.webp'],
  });
  runtime.records.comments[comment._id].status = status;
  runtime.records.comments[comment._id].reply = '商家回复';
  return { runtime, order, comment };
}

async function run() {
  for (const status of ['pending_review', 'active', 'rejected', 'inactive']) {
    const { runtime, order, comment } = await fixture(status);
    const stock = runtime.records.skus['sku-new'].stockQuantity;
    await assert.rejects(() => adminEndpoint({}, user, runtime, 'comments.delete', { id: comment._id }), errorCode('FORBIDDEN'));
    assert(runtime.records.comments[comment._id]);
    const result = await adminEndpoint({}, admin, runtime, 'comments.delete', { id: comment._id });
    assert.strictEqual(result.deleted, true);
    assert.strictEqual(runtime.records.comments[comment._id], undefined, 'remove the document, not just hide it');
    assert(result.imageCleanup.includes('cloud://test/user/comments/review.webp'));
    assert.deepStrictEqual(runtime.records.orders[order._id].commentedProductIds, []);
    assert.strictEqual(runtime.records.orders[order._id].hasPendingComments, true);
    assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stock);
    assert.strictEqual((await adminEndpoint({}, admin, runtime, 'comments.list', {})).total, 0);
    assert.strictEqual((await shopEndpoint({}, {}, runtime, 'comments.list', {})).total, 0);
    assert.strictEqual((await shopEndpoint({}, {}, runtime, 'comments.count', { productId: 'product-1' })).commentCount, 0);
    assert.strictEqual((await shopEndpoint({}, user, runtime, 'comments.list', { orderId: order._id, mineOnly: true })).total, 0);
    assert.strictEqual((await shopEndpoint({}, user, runtime, 'orders.detail', { orderId: order._id })).hasPendingComments, true);
    await assert.rejects(() => adminEndpoint({}, admin, runtime, 'comments.reply', { id: comment._id, reply: '不能复活' }), errorCode('NOT_FOUND'));
    await adminEndpoint({}, admin, runtime, 'comments.delete', { commentId: comment._id });
    const replacement = await shopEndpoint({}, user, runtime, 'comments.create', {
      orderId: order._id, productId: 'product-1', content: '重新评价', images: [],
    });
    assert.strictEqual(replacement._id, comment._id, 'the deterministic review ID can be reused after permanent deletion');
    assert.strictEqual(replacement.reply, undefined);
    assert.strictEqual(replacement.status, 'pending_review');
  }
  {
    const { runtime, order, comment } = await fixture();
    runtime.records.comments.duplicate = { ...runtime.records.comments[comment._id], _id: 'duplicate' };
    runtime.records.orders[order._id].commentedProductIds.push('other-product');
    await adminEndpoint({}, admin, runtime, 'comments.delete', { id: comment._id });
    assert.deepStrictEqual(runtime.records.orders[order._id].commentedProductIds, ['product-1', 'other-product']);
    assert.strictEqual(runtime.records.orders[order._id].hasPendingComments, false);
    await adminEndpoint({}, admin, runtime, 'comments.delete', { id: 'duplicate' });
    assert.deepStrictEqual(runtime.records.orders[order._id].commentedProductIds, ['other-product']);
    assert.strictEqual(runtime.records.orders[order._id].hasPendingComments, true);
  }
  {
    const { runtime, order, comment } = await fixture();
    runtime.records.orders[order._id].refundedQuantities = { 'sku-new': 1 };
    await adminEndpoint({}, admin, runtime, 'comments.delete', { id: comment._id });
    assert.strictEqual(runtime.records.orders[order._id].hasPendingComments, false, 'fully refunded goods must not return to pending review');
  }
  {
    const { runtime, order, comment } = await fixture();
    delete runtime.records.orders[order._id];
    await adminEndpoint({}, admin, runtime, 'comments.delete', { id: comment._id });
    assert.strictEqual(runtime.records.comments[comment._id], undefined, 'orphan reviews can be permanently deleted');
  }
  {
    const { runtime, order, comment } = await fixture();
    const original = runtime.db.runTransaction;
    runtime.db.runTransaction = (worker) => original((tx) => worker({
      ...tx,
      collection(name) {
        const ref = tx.collection(name);
        if (name !== 'comments') return ref;
        return { ...ref, doc(id) {
          const doc = ref.doc(id);
          return { ...doc, async remove() { throw new Error('injected delete failure'); } };
        } };
      },
    }));
    await assert.rejects(() => adminEndpoint({}, admin, runtime, 'comments.delete', { id: comment._id }), /injected delete failure/);
    assert(runtime.records.comments[comment._id]);
    assert.deepStrictEqual(runtime.records.orders[order._id].commentedProductIds, ['product-1']);
    assert.strictEqual(runtime.records.orders[order._id].hasPendingComments, false, 'order marker changes roll back with deletion');
  }
  console.log('PASS permanent review deletion, both clients, replies, re-review eligibility, image cleanup candidates, duplicates, orphans and transaction rollback');
}
module.exports = { run };
