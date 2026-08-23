const assert = require('assert');

const { getIdentity, requireUser } = require('../shared/auth');
const { resultData, listData, getDoc, withTransaction } = require('../shared/db');
const { normalizeOrderItems, shopEndpoint } = require('../shared/shop');
const { page } = require('../shared/validation');

function appError(code) {
  return (error) => error && error.code === code;
}

function makeRuntime() {
  const records = {
    carts: {
      'user-1': {
        _id: 'user-1',
        userId: 'user-1',
        items: [{ skuId: 'sku-old', quantity: 1, isSelected: true }],
      },
    },
    skus: {
      'sku-new': {
        _id: 'sku-new',
        skuId: 'sku-new',
        productId: 'product-1',
        status: 'active',
        stockQuantity: 10,
        price: 100,
      },
    },
    products: {
      'product-1': {
        _id: 'product-1',
        spuId: 'product-1',
        status: 'active',
        title: '测试商品',
      },
    },
    addresses: {
      'address-1': {
        _id: 'address-1',
        userId: 'user-1',
        receiver: '测试用户',
        phone: '13800000000',
        detail: '测试地址',
      },
    },
    orders: {},
  };
  const writes = [];

  function collection(name) {
    const bucket = records[name] || (records[name] = {});
    return {
      doc(id) {
        const key = String(id);
        return {
          async get() {
            const value = bucket[key];
            return { data: value ? [value] : [] };
          },
          async set(value) {
            bucket[key] = value;
            writes.push({ operation: 'set', collection: name, id: key });
            return { upserted: 1 };
          },
          async update(value) {
            if (!bucket[key]) return { updated: 0 };
            bucket[key] = { ...bucket[key], ...value };
            writes.push({ operation: 'update', collection: name, id: key });
            return { updated: 1 };
          },
          async remove() {
            if (!bucket[key]) return { deleted: 0 };
            delete bucket[key];
            writes.push({ operation: 'remove', collection: name, id: key });
            return { deleted: 1 };
          },
        };
      },
      where(query) {
        const matches = () => Object.values(bucket).filter((value) => Object.entries(query).every(([field, expected]) => value[field] === expected));
        const builder = {
          limit() { return builder; },
          skip() { return builder; },
          orderBy() { return builder; },
          async get() { return { data: matches() }; },
          async count() { return { total: matches().length }; },
        };
        return builder;
      },
    };
  }

  return {
    db: {
      collection,
      async runTransaction(worker) {
        return worker({
          collection(name) {
            const ref = collection(name);
            return {
              ...ref,
              where() { throw new Error('where is not supported inside transactions'); },
            };
          },
        });
      },
    },
    writes,
  };
}

async function testTrustedIdentityDoesNotComeFromEventUserInfo() {
  assert.strictEqual(
    getIdentity({ userInfo: { uid: 'spoofed-user' } }, {}),
    null,
    'event.userInfo must not be treated as an authenticated identity',
  );
  assert.throws(
    () => requireUser({ userInfo: { uid: 'spoofed-user' } }, {}),
    appError('UNAUTHENTICATED'),
  );
  assert.strictEqual(
    getIdentity({ userInfo: { uid: 'spoofed-user' } }, { auth: { uid: 'trusted-user' } }).uid,
    'trusted-user',
  );
}

async function testPageNumIsAcceptedAsPage() {
  assert.deepStrictEqual(page({ pageNum: 3, pageSize: 10 }), { page: 3, pageSize: 10 });
  assert.deepStrictEqual(page({ pageNum: '4', pageSize: 5 }), { page: 4, pageSize: 5 });
}

async function testMergedSkuQuantityIsCapped() {
  const duplicateItems = Array.from({ length: 50 }, () => ({ skuId: 'sku-a', quantity: 999 }));
  assert.throws(
    () => normalizeOrderItems(duplicateItems),
    appError('INVALID_ARGUMENT'),
    'merged quantity must be bounded after duplicate SKU entries are combined',
  );
}

async function testCartActionHasAnExplicitAllowlist() {
  const runtime = makeRuntime();
  await assert.rejects(
    () => shopEndpoint(
      {},
      { auth: { uid: 'user-1' } },
      runtime,
      'cart.typo',
      { skuId: 'sku-new', quantity: 1 },
    ),
    appError('INVALID_ARGUMENT'),
    'unknown cart actions must not fall through to cart.add/update',
  );
  assert.deepStrictEqual(runtime.writes, [], 'an unknown action must not write the cart');
}

async function testReplaceSkuUsesItsOwnParameterContract() {
  const runtime = makeRuntime();
  const result = await shopEndpoint(
    {},
    { auth: { uid: 'user-1' } },
    runtime,
    'cart.replaceSku',
    { oldSkuId: 'sku-old', newSkuId: 'sku-new', quantity: 1 },
  );
  assert.deepStrictEqual(result.items.map((item) => item.skuId), ['sku-new']);
}

async function testCloudBaseDocumentArrayIsUnwrapped() {
  const document = { _id: 'doc-1', value: 42 };
  assert.deepStrictEqual(resultData({ data: [document] }), [document]);
  assert.deepStrictEqual(listData({ data: [document] }), [document]);

  const collection = {
    doc() {
      return { async get() { return { data: [document] }; } };
    },
  };
  assert.deepStrictEqual(await getDoc(collection, 'doc-1', true), document);
}

async function testTransactionWrapperIsNormalized() {
  const workerResult = { orderNo: 'ord-1' };
  const db = {
    async runTransaction(worker) {
      const result = await worker({});
      return { result, errMsg: 'ok' };
    },
  };
  assert.deepStrictEqual(
    await withTransaction(db, async () => workerResult),
    workerResult,
    'withTransaction should expose the worker result, not the SDK response envelope',
  );
}

async function testOrderCreationUsesDocumentOnlyTransaction() {
  const runtime = makeRuntime();
  const result = await shopEndpoint(
    {},
    { auth: { uid: 'user-1' } },
    runtime,
    'orders.create',
    {
      requestKey: 'request-1',
      addressId: 'address-1',
      items: [{ skuId: 'sku-new', quantity: 1 }],
      useCart: false,
    },
  );
  assert.match(result.orderNo, /^ord_[a-f0-9]{32}$/);
  assert.strictEqual(result.status, 'pending_payment');
  assert.strictEqual(result.inventoryReserved, true);
  assert.strictEqual(runtime.writes.some((write) => write.operation === 'update' && write.collection === 'skus'), true);
}

const cases = [
  {
    name: 'event.userInfo is not trusted as identity',
    run: testTrustedIdentityDoesNotComeFromEventUserInfo,
  },
  { name: 'pageNum is accepted as page', run: testPageNumIsAcceptedAsPage },
  {
    name: 'duplicate SKU quantities are capped after merge',
    run: testMergedSkuQuantityIsCapped,
  },
  {
    name: 'cart actions use an explicit allowlist',
    run: testCartActionHasAnExplicitAllowlist,
  },
  {
    name: 'cart.replaceSku accepts oldSkuId/newSkuId/quantity',
    run: testReplaceSkuUsesItsOwnParameterContract,
  },
  { name: 'CloudBase data:[doc] is unwrapped', run: testCloudBaseDocumentArrayIsUnwrapped },
  {
    name: 'transaction SDK response envelope is normalized',
    run: testTransactionWrapperIsNormalized,
  },
  {
    name: 'order creation uses document-only transaction operations',
    run: testOrderCreationUsesDocumentOnlyTransaction,
  },
];

async function run() {
  const failures = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures.push({ ...testCase, error });
      console.error(`${testCase.currentGap ? 'FAIL [current gap]' : 'FAIL'} ${testCase.name}`);
      console.error(`  ${error && error.message ? error.message : error}`);
    }
  }

  if (failures.length) {
    const summary = failures.map((failure) => failure.name).join(', ');
    const error = new Error(`${failures.length} regression test(s) failed: ${summary}`);
    error.failures = failures.map((failure) => ({
      name: failure.name,
      currentGap: Boolean(failure.currentGap),
      message: failure.error && failure.error.message ? failure.error.message : String(failure.error),
    }));
    throw error;
  }
}

module.exports = { run };
