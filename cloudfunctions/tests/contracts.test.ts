// @ts-nocheck

const assert = require('assert');
const { normalizeOrderItems, skuPrice, skuStock } = require('../shared/shop');
const { getPayload, createRuntime } = require('../shared/runtime');
const { withTransaction } = require('../shared/db');
const { errorFrom } = require('../shared/errors');
const { ok, fail } = require('../shared/response');

async function run() {
  const currentEnvironment = Symbol('current-env');
  createRuntime({ cloudbase: { SYMBOL_CURRENT_ENV: currentEnvironment, init(config) {
    assert.strictEqual(config.env, currentEnvironment, 'explicit current environment avoids an SDK warning on every database request');
    return { database: () => ({}) };
  } } });
  assert.deepStrictEqual(normalizeOrderItems([
    { skuId: 'sku-a', quantity: 2 },
    { skuId: 'sku-a', quantity: 3 },
    { skuId: 'sku-b', quantity: 1 },
  ]), [
    { skuId: 'sku-a', quantity: 5 },
    { skuId: 'sku-b', quantity: 1 },
  ]);
  assert.strictEqual(skuPrice({ salePrice: 12900 }), 12900);
  assert.strictEqual(skuStock({ stockQuantity: 7 }), 7);
  assert.strictEqual(skuPrice({ priceInfo: [{ priceType: 1, price: '12900' }] }), 0);
  assert.strictEqual(skuStock({ stockInfo: { stockQuantity: 7 } }), -1);

  assert.deepStrictEqual(getPayload({ action: 'products.list', data: { page: 2 } }), {
    action: 'products.list',
    data: { page: 2 },
  });
  assert.strictEqual(ok({ value: 1 }).ok, true);
  const publicFailure = fail(errorFrom('OUT_OF_STOCK'));
  assert.strictEqual(publicFailure.ok, false);
  assert.strictEqual(publicFailure.error.code, 'OUT_OF_STOCK');
  assert.ok(publicFailure.requestId);

  let rolledBack = false;
  const transactionDb = {
    async startTransaction() {
      return {
        async rollback() { rolledBack = true; },
        async commit() { throw new Error('should not commit'); },
      };
    },
  };
  await assert.rejects(() => withTransaction(transactionDb, async () => { throw errorFrom('CONFLICT'); }), (error) => error.code === 'CONFLICT');
  assert.strictEqual(rolledBack, true);
}

module.exports = { run };
