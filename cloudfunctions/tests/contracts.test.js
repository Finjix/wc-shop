const assert = require('assert');
const { normalizeOrderItems, skuPrice, skuStock } = require('../shared/shop');
const { scopeFor } = require('../shared/admin');
const { getPayload } = require('../shared/runtime');
const { requireAdmin } = require('../shared/auth');
const { withTransaction } = require('../shared/db');
const { errorFrom } = require('../shared/errors');
const { ok, fail } = require('../shared/response');

async function run() {
  assert.deepStrictEqual(normalizeOrderItems([
    { skuId: 'sku-a', quantity: 2 },
    { skuId: 'sku-a', quantity: 3 },
    { skuId: 'sku-b', quantity: 1 },
  ]), [
    { skuId: 'sku-a', quantity: 5 },
    { skuId: 'sku-b', quantity: 1 },
  ]);
  assert.strictEqual(skuPrice({ priceInfo: [{ priceType: 1, price: '12900' }] }), 12900);
  assert.strictEqual(skuStock({ stockInfo: { stockQuantity: 7 } }), 7);
  assert.strictEqual(scopeFor('products.update'), 'catalog');
  assert.strictEqual(scopeFor('orders.ship'), 'orders');
  assert.strictEqual(scopeFor('settings.upsert'), 'settings');

  assert.deepStrictEqual(getPayload({ action: 'products.list', data: { page: 2 } }), {
    action: 'products.list',
    data: { page: 2 },
  });
  assert.strictEqual(ok({ value: 1 }).ok, true);
  const publicFailure = fail(errorFrom('OUT_OF_STOCK'));
  assert.strictEqual(publicFailure.ok, false);
  assert.strictEqual(publicFailure.error.code, 'OUT_OF_STOCK');
  assert.ok(publicFailure.requestId);

  const member = { _id: 'uid-admin', uid: 'uid-admin', roles: ['inventory'], status: 'active' };
  const db = {
    collection() {
      return {
        doc() { return { async get() { return { data: [member] }; } }; },
        where() { return { limit() { return { async get() { return { data: [] }; } }; } }; },
      };
    },
  };
  const auth = await requireAdmin(db, {}, { auth: { uid: 'uid-admin' } }, 'catalog');
  assert.deepStrictEqual(auth.roles, ['inventory']);
  await assert.rejects(() => requireAdmin(db, {}, { auth: { uid: 'uid-admin' } }, 'settings'), (error) => error.code === 'FORBIDDEN');

  const webRuntime = { auth: { getUserInfo: () => ({ uid: 'uid-admin' }) } };
  const webAuth = await requireAdmin(db, {}, {}, 'catalog', webRuntime);
  assert.strictEqual(webAuth.identity.uid, 'uid-admin');

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
