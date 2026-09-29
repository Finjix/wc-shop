// @ts-nocheck

const assert = require('assert');
const sharp = require('sharp');

const { getIdentity, requireUser } = require('../shared/auth');
const { resultData, listData, getDoc, withTransaction } = require('../shared/db');
const { normalizeOrderItems, shopEndpoint } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const { page } = require('../shared/validation');
const { validateHomeConfig, DEFAULT_SEARCH_TEXT, DEFAULT_BANNER_TEXT } = require('../shared/home-config');
const { processImageBuffer, processStagedImage, MAX_IMAGE_BYTES } = require('../shared/image-upload');

async function testImageUploads() {
  const png = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#c87a2b' } }).png().toBuffer();
  const converted = await processImageBuffer(png, 'photo.png');
  const metadata = await sharp(converted).metadata();
  assert.strictEqual(metadata.format, 'webp');
  assert.deepStrictEqual([metadata.width, metadata.height], [1080, 1350]);
  const jpeg = await sharp({ create: { width: 480, height: 240, channels: 3, background: '#9d9d9d' } }).jpeg().toBuffer();
  assert.strictEqual((await sharp(await processImageBuffer(jpeg, 'photo.jpg')).metadata()).format, 'webp');
  const webp = await sharp({ create: { width: 300, height: 500, channels: 3, background: '#3467ab' } }).webp().toBuffer();
  assert.strictEqual(await processImageBuffer(webp, 'photo.webp'), webp);
  const largeWebp = await sharp({ create: { width: 1300, height: 2600, channels: 3, background: '#3467ab' } }).webp().toBuffer();
  const resizedWebp = await sharp(await processImageBuffer(largeWebp, 'large.webp')).metadata();
  assert.deepStrictEqual([resizedWebp.width, resizedWebp.height], [1080, 2160]);
  await assert.rejects(() => processImageBuffer(png, 'photo.gif'), appError('IMAGE_FORMAT'));
  await assert.rejects(() => processImageBuffer(png, 'photo.jpg'), appError('IMAGE_FORMAT'));
  await assert.rejects(() => processImageBuffer(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'photo.png'), appError('IMAGE_TOO_LARGE'));
  const calls = [];
  const runtime = { app: {
    downloadFile: async ({ fileID }) => { calls.push(['download', fileID]); return { fileContent: png }; },
    uploadFile: async ({ cloudPath, fileContent }) => { calls.push(['upload', cloudPath]); assert.strictEqual((await sharp(fileContent).metadata()).format, 'webp'); return { fileID: `cloud://test/${cloudPath}` }; },
    deleteFile: async ({ fileList }) => { calls.push(['delete', fileList[0]]); },
  } };
  const result = await processStagedImage(runtime, 'cloud://test/pending/user/comments/photo.png', ['user/comments']);
  assert.match(result.fileID, /^cloud:\/\/test\/user\/comments\/.+\.webp$/);
  assert.deepStrictEqual(calls.map((call) => call[0]), ['download', 'upload', 'delete']);
  const categoryImage = await processStagedImage(runtime, 'cloud://test/pending/admin/categories/photo.png', ['admin/categories']);
  assert.match(categoryImage.fileID, /^cloud:\/\/test\/admin\/categories\/.+\.webp$/);
  await assert.rejects(() => processStagedImage(runtime, 'cloud://test/pending/admin/products/photo.png', ['user/comments']), appError('FORBIDDEN'));
}

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
  let nextId = 0;

  function collection(name) {
    const bucket = records[name] || (records[name] = {});
    return {
      async add(value) {
        const id = `${name}-${++nextId}`;
        bucket[id] = { ...value, _id: id };
        writes.push({ operation: 'add', collection: name, id });
        return { id };
      },
      async get() { return { data: Object.values(bucket).slice(0, 20) }; },
      async count() { return { total: Object.keys(bucket).length }; },
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
        const matches = () => Object.values(bucket).filter((value) => Object.entries(query).every(([field, expected]) => Array.isArray(value[field]) ? value[field].includes(expected) : value[field] === expected));
        let offset = 0;
        let max = Infinity;
        const builder = {
          limit(value) { max = value; return builder; },
          skip(value) { offset = value; return builder; },
          orderBy() { return builder; },
          async get() { return { data: matches().slice(offset, offset + max) }; },
          async count() { return { total: matches().length }; },
        };
        return builder;
      },
    };
  }

  return {
    records,
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

async function testSimpleProductVariantsSetCoverPriceAndSkus() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const created = await adminEndpoint({}, context, runtime, 'products.save', {
    title: '规格商品', primaryImage: 'cover.jpg', detailImages: ['detail-1.jpg', 'detail-2.jpg'],
    variants: [{ name: '大份', salePrice: 3900 }, { name: '小份', salePrice: 1900 }],
  });
  assert.strictEqual(created.minSalePrice, 1900);
  assert.strictEqual(created.maxSalePrice, 3900);
  assert.deepStrictEqual(created.images, ['cover.jpg']);
  assert.deepStrictEqual(created.detailImages, ['detail-1.jpg', 'detail-2.jpg']);
  const requiredFields = { title: '规格商品', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'], variants: [{ name: '小份', salePrice: 1900 }] };
  for (const invalid of [
    { ...requiredFields, title: '' },
    { ...requiredFields, variants: [] },
    { ...requiredFields, variants: [{ name: '小份', salePrice: 0 }] },
    { ...requiredFields, primaryImage: '' },
    { ...requiredFields, detailImages: [] },
  ]) {
    await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.save', invalid), appError('INVALID_ARGUMENT'));
  }
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.save', { title: '规格商品' }), appError('INVALID_ARGUMENT'));
  await assert.rejects(
    () => adminEndpoint({}, context, runtime, 'products.save', {
      id: created._id, title: '规格商品', primaryImage: 'cover.jpg', detailImages: [],
      variants: [{ name: '小份', salePrice: 1900 }],
    }),
    appError('INVALID_ARGUMENT'),
  );
  await assert.rejects(
    () => adminEndpoint({}, context, runtime, 'products.save', {
      id: created._id, title: '规格商品', primaryImage: 'cover.jpg', detailImages: Array(7).fill('detail.jpg'),
      variants: [{ name: '小份', salePrice: 1900 }],
    }),
    appError('INVALID_ARGUMENT'),
  );
  assert.strictEqual(created.specList[0].specValueList.length, 2);
  const skus = Object.values(runtime.records.skus).filter((sku) => sku.productId === created._id);
  assert.strictEqual(skus.length, 2);
  const small = skus.find((sku) => sku.salePrice === 1900);
  assert.strictEqual(small.specInfo[0].specValueId, created.specList[0].specValueList[1].specValueId);
  const updated = await adminEndpoint({}, context, runtime, 'products.save', {
    id: created._id, title: '规格商品', primaryImage: 'new-cover.jpg', detailImages: ['detail-1.jpg'],
    variants: [{ skuId: small._id, name: '小份', salePrice: 2400 }],
  });
  assert.strictEqual(updated.minSalePrice, 2400);
  assert.deepStrictEqual(updated.images, ['new-cover.jpg']);
  assert.deepStrictEqual(updated.detailImages, ['detail-1.jpg']);
  assert.strictEqual(runtime.records.skus[small._id].salePrice, 2400);
  const removedSkuId = skus.find((sku) => sku._id !== small._id)._id;
  assert.strictEqual(runtime.records.skus[removedSkuId].status, 'inactive');
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'inactive' });
  assert.strictEqual(runtime.records.products[created._id].status, 'inactive');
  assert.strictEqual(runtime.records.skus[small._id].status, 'active');
  assert.strictEqual(runtime.records.skus[removedSkuId].status, 'inactive');
  await assert.rejects(() => shopEndpoint({}, {}, runtime, 'products.detail', { productId: created._id }));
  assert.deepStrictEqual((await shopEndpoint({}, {}, runtime, 'skus.list', { productId: created._id })).items, []);
  assert.deepStrictEqual((await shopEndpoint({}, {}, runtime, 'skus.list', {})).items.map((sku) => sku._id), ['sku-new']);
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'active' });
  assert.strictEqual(runtime.records.products[created._id].status, 'active');
  assert.strictEqual(runtime.records.skus[small._id].status, 'active');
  assert.strictEqual(runtime.records.skus[removedSkuId].status, 'inactive');
  assert.strictEqual(runtime.records.products[created._id].minSalePrice, 2400);
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'invalid' }), appError('INVALID_ARGUMENT'));
}

async function testProductSaveManagesSkuInventoryStatusAndImages() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const base = { title: '统一管理商品', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'] };
  const created = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base,
    variants: [
      { name: '小份', salePrice: 1900, stockQuantity: 8, skuImage: 'small.webp', status: 'active' },
      { name: '大份', salePrice: 3900, stockQuantity: 5, status: 'active' },
      { name: '暂停售卖', salePrice: 900, stockQuantity: 2, status: 'inactive' },
    ],
  });
  assert.strictEqual(created.minSalePrice, 1900);
  assert.strictEqual(created.maxSalePrice, 3900);
  const byName = Object.fromEntries(created.specList[0].specValueList.map((item) => [item.specValue, item.specValueId]));
  assert.strictEqual(runtime.records.skus[byName['小份']].stockQuantity, 8);
  assert.strictEqual(runtime.records.skus[byName['小份']].skuImage, 'small.webp');
  assert.strictEqual(runtime.records.skus[byName['暂停售卖']].status, 'inactive');
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'inactive' });
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'active' });
  assert.strictEqual(runtime.records.skus[byName['小份']].status, 'active');
  assert.strictEqual(runtime.records.skus[byName['暂停售卖']].status, 'inactive');
  await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [
      { skuId: byName['小份'], name: '小份', salePrice: 1900, status: 'active' },
      { skuId: byName['大份'], name: '大份', salePrice: 3900, status: 'active' },
      { skuId: byName['暂停售卖'], name: '暂停售卖', salePrice: 900, status: 'inactive' },
    ],
  });
  assert.strictEqual(runtime.records.skus[byName['暂停售卖']].status, 'inactive');
  const publicDetail = await shopEndpoint({}, {}, runtime, 'products.detail', { productId: created._id });
  assert.strictEqual(publicDetail.product.minSalePrice, 1900);
  assert.deepStrictEqual(publicDetail.skus.map((sku) => sku.stockQuantity).sort(), [5, 8]);

  runtime.records.skus[byName['大份']].stockQuantity = 4; // 模拟编辑期间下单扣库存
  const updated = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [
      { skuId: byName['小份'], name: '小份', salePrice: 2200, stockQuantity: 7, expectedStockQuantity: 8, skuImage: '', status: 'active' },
      { skuId: byName['大份'], name: '大份', salePrice: 3900, status: 'inactive' },
    ],
  });
  assert.strictEqual(updated.minSalePrice, 2200);
  assert.strictEqual(updated.maxSalePrice, 2200);
  assert.strictEqual(runtime.records.skus[byName['小份']].stockQuantity, 7);
  assert.strictEqual(runtime.records.skus[byName['小份']].skuImage, '');
  assert.strictEqual(runtime.records.skus[byName['大份']].stockQuantity, 4);
  assert.strictEqual(runtime.records.skus[byName['大份']].status, 'inactive');
  assert.strictEqual(runtime.records.skus[byName['暂停售卖']].status, 'inactive');

  const reactivated = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [
      { skuId: byName['小份'], name: '小份', salePrice: 2200, status: 'active' },
      { skuId: byName['大份'], name: '大份', salePrice: 1800, status: 'active' },
    ],
  });
  assert.strictEqual(reactivated.minSalePrice, 1800);
  assert.strictEqual(runtime.records.skus[byName['大份']].stockQuantity, 4);
  assert.strictEqual(runtime.records.skus[byName['大份']].status, 'active');

  const writesBeforeConflict = runtime.writes.length;
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [{ skuId: byName['小份'], name: '小份', salePrice: 2200, stockQuantity: 6, expectedStockQuantity: 8 }],
  }), appError('CONFLICT'));
  assert.strictEqual(runtime.writes.length, writesBeforeConflict);
  assert.strictEqual(runtime.records.skus[byName['小份']].stockQuantity, 7);
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [{ skuId: byName['小份'], name: '小份', salePrice: 2200, status: 'inactive' }],
  }), appError('INVALID_ARGUMENT'));
}

async function testSkuInventoryCanBeSetSeparatelyWithoutProductSaveResettingIt() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const base = { title: '分开管理库存', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'] };
  const created = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base,
    variants: [{ name: '标准', salePrice: 1000, status: 'active' }],
  });
  const skuId = created.specList[0].specValueList[0].specValueId;
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 999);

  await adminEndpoint({}, context, runtime, 'inventory.adjust', { skuId, stockQuantity: 10, expectedStockQuantity: 999 });
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 10);
  assert.strictEqual((await shopEndpoint({}, {}, runtime, 'products.detail', { productId: created._id })).skus[0].stockQuantity, 10);

  await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [{ skuId, name: '标准版', salePrice: 1200, status: 'active' }],
  });
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 10);

  runtime.records.skus[skuId].stockQuantity = 9; // 模拟管理员读取后发生销售
  const writesBeforeConflict = runtime.writes.length;
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'inventory.adjust', {
    skuId, stockQuantity: 8, expectedStockQuantity: 10,
  }), appError('CONFLICT'));
  assert.strictEqual(runtime.writes.length, writesBeforeConflict);
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 9);
  await adminEndpoint({}, context, runtime, 'inventory.adjust', { skuId, stockQuantity: 8, expectedStockQuantity: 9 });
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 8);
}

async function testProductSkuListAndSaveReadEveryVariant() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const variants = Array.from({ length: 100 }, (_, index) => {
    const skuId = `sku-${index}`;
    runtime.records.skus[skuId] = { _id: skuId, skuId, productId: 'product-1', spuId: 'product-1', status: 'active', stockQuantity: index, salePrice: 1000 };
    return { skuId, name: `规格 ${index}`, salePrice: 1000, status: 'active' };
  });
  const listed = await adminEndpoint({}, context, runtime, 'skus.list', { productId: 'product-1' });
  assert.strictEqual(listed.items.length, 101);
  await adminEndpoint({}, context, runtime, 'products.save', {
    id: 'product-1', title: '测试商品', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'], variants,
  });
  assert.strictEqual(runtime.records.skus['sku-99'].stockQuantity, 99);
  assert.strictEqual(runtime.records.skus['sku-99'].status, 'active');
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

async function testOrderCreationRechecksProductStatus() {
  const runtime = makeRuntime();
  const originalTransaction = runtime.db.runTransaction.bind(runtime.db);
  runtime.db.runTransaction = (worker) => {
    runtime.records.products['product-1'].status = 'inactive';
    return originalTransaction(worker);
  };
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, 'orders.create', {
    requestKey: 'status-race', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  }), appError('SKU_UNAVAILABLE'));
  assert.deepStrictEqual(runtime.records.orders, {});
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);
}

async function testDashboardProductCountUsesCountQuery() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  for (let index = 0; index < 25; index += 1) runtime.records.products[`extra-${index}`] = { _id: `extra-${index}` };
  const result = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'dashboard.summary', {});
  assert.strictEqual(result.metrics.productCount, 26);
}

async function testHomeConfigLimitsAndLegacyResponse() {
  const blankLink = { image: '', productId: '' };
  const config = {
    searchText: DEFAULT_SEARCH_TEXT,
    bannerText: DEFAULT_BANNER_TEXT,
    banners: [{ image: 'cloud://home/slide.jpg', productId: 'product-1' }, blankLink, blankLink],
    promos: [blankLink, blankLink],
    sections: [{ id: 'featured', title: '精选', productIds: Array(6).fill('product-1') }],
  };
  assert.strictEqual(validateHomeConfig(config).sections[0].productIds.length, 6);
  for (const count of [0, 1, 2, 3, 4]) {
    assert.strictEqual(validateHomeConfig({ ...config, sections: [{ ...config.sections[0], productIds: Array(count).fill('product-1') }] }).sections[0].productIds.length, count);
  }
  assert.strictEqual(validateHomeConfig({ ...config, searchText: '' }).searchText, '');
  assert.deepStrictEqual(validateHomeConfig({ ...config, banners: [{ image: 'cloud://home/banner.webp', productId: '' }], promos: [{ image: 'cloud://home/promo.webp', productId: '' }, blankLink] }).banners[0], { image: 'cloud://home/banner.webp', productId: '' });
  assert.strictEqual(validateHomeConfig({ ...config, bannerText: '' }).bannerText, '');
  assert.deepStrictEqual(validateHomeConfig({ ...config, sections: [{ ...config.sections[0], title: '', productIds: ['', 'product-1'] }] }).sections[0], { id: 'featured', title: '', productIds: ['', 'product-1'] });
  assert.deepStrictEqual(validateHomeConfig({ ...config, banners: [{ image: '', productId: 'product-1' }] }).banners[0], { image: '', productId: 'product-1' });
  assert.throws(() => validateHomeConfig({ ...config, sections: [{ ...config.sections[0], productIds: Array(8).fill('product-1') }] }), appError('INVALID_ARGUMENT'));
  assert.deepStrictEqual(validateHomeConfig({ ...config, sections: [] }).sections, []);
  assert.throws(() => validateHomeConfig({ ...config, sections: Array(7).fill(config.sections[0]) }), appError('INVALID_ARGUMENT'));
  assert.strictEqual(validateHomeConfig({ ...config, banners: Array(6).fill(blankLink) }).banners.length, 6);
  assert.deepStrictEqual(validateHomeConfig({ ...config, banners: [] }).banners, []);
  assert.throws(() => validateHomeConfig({ ...config, banners: Array(7).fill(blankLink) }), appError('INVALID_ARGUMENT'));

  const runtime = makeRuntime();
  runtime.records.homeContents = {
    'legacy-banner': { _id: 'legacy-banner', slot: 'home.banner.1', type: 'banner', image: 'legacy.jpg', status: 'active', sort: 0 },
    'home.page-config': { _id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', payload: config, status: 'active', sort: -100 },
  };
  const result = await shopEndpoint({}, {}, runtime, 'home.get', {});
  assert.strictEqual(result.items.length, 2, 'legacy items remain available');
  assert.deepStrictEqual(result.config, config);
  assert.strictEqual(result.productsById['product-1'].title, '测试商品');

  const writable = makeRuntime();
  writable.records.adminMembers = {};
  writable.records.adminMembers['admin-1'] = { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' };
  const saved = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, writable, 'homeContent.save', {
    id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', status: 'active', payload: config,
  });
  assert.deepStrictEqual(saved.payload, config);
  const loaded = await shopEndpoint({}, {}, writable, 'home.get', {});
  assert.strictEqual(loaded.config.sections[0].productIds.length, 6);
  assert.strictEqual(loaded.productsById['product-1'].title, '测试商品');
  for (const count of [0, 1, 2, 3, 4]) {
    const smallerConfig = { ...config, sections: [{ ...config.sections[0], productIds: Array(count).fill('product-1') }] };
    await adminEndpoint({}, { auth: { uid: 'admin-1' } }, writable, 'homeContent.save', {
      id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', status: 'active', payload: smallerConfig,
    });
    assert.deepStrictEqual((await shopEndpoint({}, {}, writable, 'home.get', {})).config.sections[0].productIds, smallerConfig.sections[0].productIds);
  }
  const cleared = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, writable, 'homeContent.save', {
    id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', status: 'active', payload: { ...config, searchText: '' },
  });
  assert.strictEqual(cleared.payload.searchText, '');
  assert.strictEqual((await shopEndpoint({}, {}, writable, 'home.get', {})).config.searchText, '');
  writable.records.products['product-1'].status = 'inactive';
  const afterRemoval = await shopEndpoint({}, {}, writable, 'home.get', {});
  assert.strictEqual(afterRemoval.productsById['product-1'], undefined, 'unavailable products are omitted');
  const unfinished = { ...config, banners: [{ image: '', productId: 'product-1' }], sections: [{ id: 'featured', title: '', productIds: ['', 'product-1'] }] };
  const savedUnfinished = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, writable, 'homeContent.save', {
    id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', status: 'active', payload: unfinished,
  });
  assert.deepStrictEqual(savedUnfinished.payload, unfinished);
  const unfinishedHome = await shopEndpoint({}, {}, writable, 'home.get', {});
  assert.deepStrictEqual(unfinishedHome.config, unfinished);
  assert.strictEqual(unfinishedHome.productsById['product-1'], undefined);
  const entirelyBlank = {
    searchText: '', bannerText: '', banners: [blankLink], promos: [blankLink, blankLink],
    sections: [{ id: 'empty', title: '', productIds: ['', ''] }],
  };
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, writable, 'homeContent.save', {
    id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', status: 'active', payload: entirelyBlank,
  });
  const blankHome = await shopEndpoint({}, {}, writable, 'home.get', {});
  assert.deepStrictEqual(blankHome.config, entirelyBlank);
  assert.deepStrictEqual(blankHome.productsById, {});
}

async function testTwoLevelCategoriesAndCascadeDeletion() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const parent = await adminEndpoint({}, context, runtime, 'categories.save', { name: '鞋靴', parentId: null });
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [parent._id] });
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [parent._id]);
  const child = await adminEndpoint({}, context, runtime, 'categories.save', { name: '皮鞋', parentId: parent._id, image: 'cloud://test/admin/categories/cover.webp' });
  assert.strictEqual(parent.level, 1);
  assert.strictEqual(child.level, 2);
  assert.strictEqual(child.parentId, parent._id);
  assert.strictEqual(child.image, 'cloud://test/admin/categories/cover.webp');
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [child._id]);
  await adminEndpoint({}, context, runtime, 'products.save', {
    id: 'product-1', title: '修改后的商品', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'],
    categoryIds: [child._id], variants: [{ skuId: 'sku-new', name: '规格', salePrice: 100, status: 'active' }],
  });
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'categories.save', { name: '错误图片', parentId: null, image: 'cloud://test/admin/categories/cover.webp' }), appError('INVALID_ARGUMENT'));
  const renamedChild = await adminEndpoint({}, context, runtime, 'categories.save', { id: child._id, name: '男士皮鞋' });
  assert.strictEqual(renamedChild.image, child.image);
  const clearedChild = await adminEndpoint({}, context, runtime, 'categories.save', { id: child._id, image: '' });
  assert.strictEqual(clearedChild.image, '');
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'categories.save', { name: '三级', parentId: child._id }), appError('INVALID_ARGUMENT'));
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'categories.save', { name: '无效', parentId: 'missing' }), appError('INVALID_ARGUMENT'));
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [parent._id] });
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [child._id]);
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [child._id] });
  runtime.records.products['product-1'].categoryId = child._id;
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [child._id]);
  const publicCategories = await shopEndpoint({}, {}, runtime, 'categories.list', {});
  assert.deepStrictEqual(publicCategories.items.map((item) => item._id), [parent._id, child._id]);
  assert.strictEqual(publicCategories.items[1].image, '');
  const deleted = await adminEndpoint({}, context, runtime, 'categories.delete', { id: parent._id });
  assert.deepStrictEqual(deleted.removedIds, [parent._id, child._id]);
  assert.strictEqual(runtime.records.categories[parent._id].status, 'inactive');
  assert.strictEqual(runtime.records.categories[child._id].status, 'inactive');
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, []);
  assert.strictEqual(runtime.records.products['product-1'].categoryId, null);
  assert.strictEqual(runtime.records.products['product-1'].status, 'active');
  assert.deepStrictEqual((await shopEndpoint({}, {}, runtime, 'categories.list', {})).items, []);

  const nextParent = await adminEndpoint({}, context, runtime, 'categories.save', { name: '配件', parentId: null });
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [nextParent._id] });
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [nextParent._id]);
  runtime.records.categories.orphan = { _id: 'orphan', name: '旧分类', parentId: 'missing', status: 'active' };
  const repaired = await adminEndpoint({}, context, runtime, 'categories.save', { id: 'orphan', name: '旧分类', parentId: nextParent._id });
  assert.strictEqual(repaired.parentId, nextParent._id);
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [repaired._id]);
  const nextChild = await adminEndpoint({}, context, runtime, 'categories.save', { name: '鞋垫', parentId: nextParent._id });
  runtime.records.products['product-1'].categoryIds = [nextParent._id]; // 模拟旧数据仍挂在一级分类
  runtime.records.products['legacy-product'] = { _id: 'legacy-product', categoryId: nextParent._id, categoryIds: [] };
  const lastChild = await adminEndpoint({}, context, runtime, 'categories.save', { name: '鞋带', parentId: nextParent._id });
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [repaired._id]);
  assert.deepStrictEqual(runtime.records.products['legacy-product'].categoryIds, [repaired._id]);
  assert.strictEqual(runtime.records.products['legacy-product'].categoryId, null);
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [nextParent._id] });
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [repaired._id]);
  await adminEndpoint({}, context, runtime, 'categories.reorder', { parentId: nextParent._id, ids: [lastChild._id, repaired._id, nextChild._id] });
  assert.strictEqual(runtime.records.categories[lastChild._id].sort, 0);
  assert.strictEqual(runtime.records.categories[nextChild._id].sort, 2);
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [nextParent._id] });
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, [repaired._id]);
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'categories.reorder', { parentId: nextParent._id, ids: [nextParent._id, lastChild._id] }), appError('INVALID_ARGUMENT'));
  await adminEndpoint({}, context, runtime, 'products.update', { id: 'product-1', categoryIds: [nextChild._id] });
  await adminEndpoint({}, context, runtime, 'categories.delete', { id: nextChild._id });
  assert.strictEqual(runtime.records.categories[nextParent._id].status, 'active');
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, []);
}

const cases = [
  { name: 'image uploads validate format, size, conversion and staging', run: testImageUploads },
  { name: 'simple product variants set cover price and SKUs', run: testSimpleProductVariantsSetCoverPriceAndSkus },
  { name: 'product save manages SKU inventory, status, images and conflicts', run: testProductSaveManagesSkuInventoryStatusAndImages },
  { name: 'SKU inventory is set separately and stale updates conflict', run: testSkuInventoryCanBeSetSeparatelyWithoutProductSaveResettingIt },
  { name: 'product SKU list and save read every variant', run: testProductSkuListAndSaveReadEveryVariant },
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
  { name: 'order creation rechecks product status inside transaction', run: testOrderCreationRechecksProductStatus },
  { name: 'dashboard product count is not limited to the first page', run: testDashboardProductCountUsesCountQuery },
  { name: 'home configuration limits and legacy response', run: testHomeConfigLimitsAndLegacyResponse },
  { name: 'two-level categories validate hierarchy and clear products on deletion', run: testTwoLevelCategoriesAndCascadeDeletion },
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
