// @ts-nocheck
const assert = require('assert');
const { makeRuntime, localAddress } = require('./regressions.test');
const { adminEndpoint } = require('../shared/admin');
const { shopEndpoint } = require('../shared/shop');
const { purgeDeletedCatalog, sweep } = require('../shared/catalog-lifecycle');
const { stateId } = require('../shared/image-lifecycle');

async function run() {
  const runtime = makeRuntime(), user = { auth: { uid: 'user-1' } };
  runtime.records.skus['sku-new'].skuImage = 'cloud://test.bucket/admin/products/inventory.webp';
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'deleted-inventory-refund', addressId: 'address-1', address: localAddress, items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  runtime.records.carts['user-1'].items = [{ skuId: 'sku-new', quantity: 1 }];
  await adminEndpoint({}, {}, runtime, 'products.delete', { id: 'product-1' });
  assert(runtime.records.skus['sku-new'], 'an order retains its inventory ledger');
  assert.strictEqual(runtime.records.carts['user-1'], undefined, 'deleted catalog items are removed from carts');
  const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 20, reason: '取消' });
  await adminEndpoint({}, {}, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10, 'refund still restores inventory after catalog deletion');
  await adminEndpoint({}, {}, runtime, 'orders.delete', { orderId: order._id });
  await purgeDeletedCatalog(runtime);
  assert.strictEqual(runtime.records.skus['sku-new'], undefined);
  assert.strictEqual(runtime.records.products['product-1'], undefined);
  await adminEndpoint({}, {}, runtime, 'products.delete', { id: 'product-1' });

  const pending = makeRuntime();
  pending.records.payments = { live: { _id: 'live', status: 'pending', draftOrders: [{ items: [{ skuId: 'sku-new', productId: 'product-1' }] }] } };
  await adminEndpoint({}, {}, pending, 'products.delete', { id: 'product-1' });
  assert(pending.records.skus['sku-new'], 'unpaid reservations retain inventory until release');
  pending.records.payments.live.status = 'closed';
  await purgeDeletedCatalog(pending);
  assert.strictEqual(pending.records.skus['sku-new'], undefined);

  const rotation = makeRuntime();
  rotation.records.orders.protect = { _id: 'protect', items: [] };
  for (let index = 0; index < 26; index++) {
    const key = `deleted-${String(index).padStart(2, '0')}`;
    rotation.records.skus[key] = { _id: key, skuId: key, productId: 'product-1', deletedByAdmin: true };
    if (index < 25) rotation.records.orders.protect.items.push({ skuId: key });
  }
  await purgeDeletedCatalog(rotation);
  await purgeDeletedCatalog(rotation);
  assert.strictEqual(rotation.records.skus['deleted-25'], undefined, 'protected first page cannot starve later orphaned SKUs');

  const race = makeRuntime();
  race.records.skus['sku-new'].deletedByAdmin = true;
  const originalCollection = race.db.collection;
  race.db.collection = (name) => {
    const ref = originalCollection(name);
    if (name !== 'payments') return ref;
    return { ...ref, where(query) {
      const request = ref.where(query), get = request.get;
      request.get = async () => {
        // A callback commits after the order scan, removing the payment from
        // the pending scan. An image-free order still changes the fence.
        const response = await get();
        const wrapped = require('../shared/image-lifecycle').imageLifecycleRuntime(race);
        await wrapped.db.collection('orders').doc('late-paid').set({ items: [{ skuId: 'sku-new', productId: 'product-1' }] });
        return response;
      };
      return request;
    } };
  };
  await assert.rejects(() => purgeDeletedCatalog(race), error => error.code === 'CONFLICT');
  assert(race.records.skus['sku-new'], 'a callback cannot lose inventory between the two dependency scans');

  const retry = makeRuntime(), image = 'cloud://test.bucket/home/retry.webp';
  retry.records.settings = { [stateId(image)]: { fileID: image, imageCleanupPending: true, cleanupAfter: '2000-01-01' } };
  retry.app = { deleteFile: async () => { throw new Error('storage offline'); } };
  await assert.rejects(() => sweep(retry), /storage offline/);
  assert(retry.records.settings[stateId(image)].imageCleanupPending);
  retry.app.deleteFile = async ({ fileList }) => ({ fileList: fileList.map(fileID => ({ fileID, code: 'SUCCESS' })) });
  assert.strictEqual((await sweep(retry)).deleted, 1, 'the server worker retries without any browser visit');
  console.log('PASS catalog purge, refund inventory, callback race fence, cart cascade, cursor fairness and autonomous image retry');
}
module.exports = { run };
