// @ts-nocheck
const assert = require('assert');
const { makeRuntime } = require('./regressions.test');
const { reconcile } = require('../shared/payments');
const { sweep } = require('../shared/catalog-lifecycle');

function measuredRuntime() {
  const runtime = makeRuntime(), calls = { reads: 0, writes: 0 };
  const collection = runtime.db.collection;
  const track = (ref) => new Proxy(ref, { get(target, key) {
    if (typeof target[key] !== 'function') return target[key];
    return (...args) => {
      if (['get', 'count'].includes(key)) calls.reads++;
      if (['set', 'update', 'remove', 'add'].includes(key)) calls.writes++;
      const result = target[key](...args);
      return ['where', 'doc', 'orderBy', 'limit', 'skip'].includes(key) ? track(result) : result;
    };
  } });
  runtime.db.collection = name => track(collection(name));
  // Real deployments keep old cursors and compact tombstones after deletion.
  runtime.records.settings = {
    __payment_reconcile_schedule: { nextQueue: 1 },
    __payment_reconcile_pending: { cursor: 'old-payment' },
    __payment_reconcile_refunds: { cursor: 'old-refund' },
    __payment_reconcile_shipping: { cursor: 'old-shipping' },
    __image_catalog_products: { cursor: 'old-product' },
    __image_catalog_skus: { cursor: 'old-sku' },
    __image_compaction_cursor: { cursor: '__image_file_old' },
    __image_file_old: { _id: '__image_file_old', status: 'deleted', imageCleanupPending: false },
  };
  return { runtime, calls };
}

async function run() {
  const payment = measuredRuntime();
  const before = JSON.stringify(payment.runtime.records.settings);
  await reconcile(payment.runtime);
  await reconcile(payment.runtime);
  assert.deepStrictEqual(payment.calls, { reads: 6, writes: 0 }, 'idle payment ticks use three queries and never touch cursor documents');
  assert.strictEqual(JSON.stringify(payment.runtime.records.settings), before);

  const images = measuredRuntime();
  await sweep(images.runtime);
  assert(images.calls.reads <= 6, `empty catalog/image queues must stay bounded: ${JSON.stringify(images.calls)}`);
  assert.strictEqual(images.calls.writes, 0, 'already compact metadata must not be rewritten on each tick');
  console.log(`PASS idle maintenance budget: payment=3 reads/0 writes; image=${images.calls.reads} reads/0 writes, including legacy cursors`);
}
module.exports = { run };
