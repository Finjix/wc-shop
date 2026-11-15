// @ts-nocheck
const assert = require('assert');
const { makeRuntime } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const { catalogRows, invalidateCatalog } = require('../shared/catalog-cache');

async function run() {
  const runtime = makeRuntime();
  runtime.catalogCacheEnabled = true;
  const original = runtime.db.collection;
  const reads = {};
  let fail = false;
  const wrap = (ref, name) => new Proxy(ref, { get(target, property) {
    if (property === 'get') return async () => {
      reads[name] = (reads[name] || 0) + 1;
      if (fail && name === 'products') throw new Error('temporary failure');
      return target.get();
    };
    if (['where', 'orderBy', 'skip', 'limit', 'doc'].includes(property)) return (...args) => wrap(target[property](...args), name);
    return typeof target[property] === 'function' ? target[property].bind(target) : target[property];
  } });
  runtime.db.collection = name => wrap(original(name), name);
  const shop = (action, data = {}) => shopEndpoint({}, {}, runtime, action, data);
  const first = await Promise.all([shop('home.feed'), shop('home.feed')]);
  assert.strictEqual(reads.products, 1, 'parallel homepage scans coalesce');
  await shop('home.feed', { cursor: first[0].nextCursor });
  assert.strictEqual(reads.products, 1, 'recommendation pagination reuses the catalog');
  const search = await shop('products.list', { keyword: '测试' });
  assert.strictEqual(search.total, 1);
  const before = { ...reads };
  await shop('products.list', { keyword: '商品', page: 2 });
  assert.strictEqual(reads.products, before.products);
  assert.strictEqual(reads.skus, before.skus, 'different keywords and pages reuse SKU scans');
  assert.strictEqual(reads.categories, before.categories);
  await shop('products.detail', { productId: 'product-1' });
  assert(reads.products > before.products && reads.skus > before.skus, 'detail bypasses catalog caches');
  await adminEndpoint({}, {}, runtime, 'products.update', { id: 'product-1', title: '新标题' });
  const refreshed = await shop('home.feed');
  assert.strictEqual(refreshed.items[0].title, '新标题');
  const afterEdit = reads.products;
  const now = Date.now;
  try {
    Date.now = () => now() + 31000;
    await shop('home.feed');
    assert.strictEqual(reads.products, afterEdit + 1, 'cache expires after thirty seconds');
  } finally { Date.now = now; }
  invalidateCatalog(runtime);
  fail = true;
  await assert.rejects(catalogRows(runtime, 'products'), /temporary failure/);
  fail = false;
  assert.strictEqual((await catalogRows(runtime, 'products')).length, 1, 'failed scans can retry');
  const other = makeRuntime(); other.catalogCacheEnabled = true;
  other.records.products = {};
  assert.strictEqual((await catalogRows(other, 'products')).length, 0, 'database instances never share data');
  console.log('PASS catalog cache: concurrent scans, feed/search reuse, fresh details, admin invalidation, TTL, retry and isolation');
}
module.exports = { run };
