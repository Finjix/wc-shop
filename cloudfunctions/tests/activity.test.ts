// @ts-nocheck
const assert = require('assert');
const { makeRuntime, localAddress } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const { activityPrice } = require('../shared/activity');

async function run() {
  const runtime = makeRuntime();
  const shop = (action, data = {}) => shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, action, data);
  const admin = (action, data = {}) => adminEndpoint({}, {}, runtime, action, data);
  const product = runtime.records.products['product-1'];
  product.minSalePrice = 100; product.maxSalePrice = 100;
  const originalProduct = JSON.stringify(product);
  assert.deepStrictEqual(await admin('activity.get'), { enabled: false, type: 'percentage', value: 0 });
  for (const data of [
    { enabled: true, type: 'percentage', value: 100 },
    { enabled: true, type: 'percentage', value: -1 },
    { enabled: true, type: 'amount', value: 0.5 },
    { enabled: true, type: 'amount', value: 0 },
    { enabled: true, type: 'other', value: 10 },
    { enabled: 'true', type: 'percentage', value: 10 },
    { enabled: true, type: 'percentage', value: '10' },
  ]) await assert.rejects(admin('activity.save', data), (error) => error.code === 'INVALID_ARGUMENT');
  await admin('activity.save', { enabled: true, type: 'percentage', value: 10 });
  const originalCollection = runtime.db.collection;
  let skuReads = 0;
  runtime.db.collection = (name) => {
    if (name === 'skus') skuReads++;
    return originalCollection(name);
  };
  const listing = await shop('products.list', { sort: 1, minPrice: 89, maxPrice: 91 });
  assert.strictEqual(listing.items[0].minSalePrice, 90);
  assert.strictEqual(skuReads, 0, 'activity price filtering does not scan the SKU collection');
  runtime.db.collection = originalCollection;
  const details = await shop('products.detail', { productId: 'product-1' });
  assert.strictEqual(details.product.minSalePrice, 90);
  assert.strictEqual(details.product.originalPrice, 100);
  assert.strictEqual(details.skus[0].salePrice, 90);
  assert.strictEqual(details.skus[0].originalPrice, 100);
  const filtered = await shop('products.list', { minPrice: 89, maxPrice: 91 });
  assert.strictEqual(filtered.total, 1);
  assert.strictEqual(filtered.items[0].minSalePrice, 90);
  assert.strictEqual((await shop('products.list', { minPrice: 99 })).total, 0);
  const feed = await shop('home.feed');
  assert.strictEqual(feed.items[0].minSalePrice, 90);
  assert.strictEqual(feed.items[0].originalPrice, 100);
  await shop('cart.clear');
  const cart = await shop('cart.add', { skuId: 'sku-new', quantity: 2 });
  assert.strictEqual(cart.items[0].price, 90);
  assert.strictEqual(cart.items[0].unitPrice, 90);
  const preview = await shop('orders.preview', { useCart: true });
  assert.strictEqual(preview.totalAmount, 180);
  const order = await shop('orders.create', { requestKey: 'activity-order', address: localAddress, items: [{ skuId: 'sku-new', quantity: 2 }] });
  assert.strictEqual(order.totalAmount, 180);
  assert.strictEqual(order.items[0].unitPrice, 90);
  await admin('activity.save', { enabled: true, type: 'amount', value: 30 });
  assert.strictEqual((await shop('products.detail', { productId: 'product-1' })).skus[0].salePrice, 70);
  // Repeated requests never compound discounts or rewrite original catalog prices.
  assert.strictEqual((await shop('products.detail', { productId: 'product-1' })).skus[0].salePrice, 70);
  assert.strictEqual(runtime.records.skus['sku-new'].salePrice, 100);
  assert.strictEqual(JSON.stringify(runtime.records.products['product-1']), originalProduct);
  assert.strictEqual(activityPrice(101, { enabled: true, type: 'percentage', value: 50 }), 51);
  assert.strictEqual(activityPrice(100, { enabled: true, type: 'amount', value: 10000 }), 1);
  await admin('activity.save', { enabled: false, type: 'amount', value: 30 });
  const restored = await shop('products.detail', { productId: 'product-1' });
  assert.strictEqual(restored.product.minSalePrice, 100);
  assert.strictEqual(restored.product.originalPrice, 0);
  assert.strictEqual(restored.skus[0].salePrice, 100);
  assert.strictEqual((await shop('cart.get')).items[0].price, 100);
  assert.strictEqual(runtime.records.orders[order._id].totalAmount, 180);
  console.log('PASS global activity validation, display, filtering, cart, checkout, rounding, unchanged base prices and restoration');
}
module.exports = { run };
