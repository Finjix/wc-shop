// @ts-nocheck

const assert = require('assert');
const sharp = require('sharp');

const { getIdentity, requireUser, requireAdmin } = require('../shared/auth');
const { resultData, listData, getDoc, withTransaction } = require('../shared/db');
const { normalizeOrderItems, shopEndpoint } = require('../shared/shop');
const { STATUS, ORDER_STATUS } = require('../shared/constants');
const { adminEndpoint } = require('../shared/admin');
const { page } = require('../shared/validation');
const { validateHomeConfig, DEFAULT_SEARCH_TEXT, DEFAULT_BANNER_TEXT } = require('../shared/home-config');
const { processImageBuffer, processStagedImage, MAX_IMAGE_BYTES } = require('../shared/image-upload');
const { isNotFound, toPublicError } = require('../shared/errors');

function testMissingDependenciesAreNotMissingData() {
  for (const code of ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ENOENT']) {
    const error = Object.assign(new Error("Cannot find module 'lodash/set'"), { code });
    assert.strictEqual(isNotFound(error), false);
    assert.strictEqual(toPublicError(error).code, 'INTERNAL_ERROR');
  }
  assert.strictEqual(isNotFound(new Error('document does not exist')), true);
}

async function testImageUploads() {
  assert.strictEqual(MAX_IMAGE_BYTES, 1 * 1024 * 1024);
  const png = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#c87a2b' } }).png().toBuffer();
  const original = await processImageBuffer(png, 'photo.PNG');
  assert.strictEqual(original, png);
  const metadata = await sharp(original).metadata();
  assert.strictEqual(metadata.format, 'png');
  assert.deepStrictEqual([metadata.width, metadata.height], [1200, 1500]);
  for (const extension of ['jpg', 'JPEG', 'webp', 'GIF', 'svg', 'bmp', 'avif', 'heic', 'tiff', 'ico', 'psd']) {
    const bytes = Buffer.from(`Original ${extension} image bytes`);
    assert.strictEqual(await processImageBuffer(bytes, `photo.${extension}`), bytes);
  }
  const boundary = Buffer.alloc(MAX_IMAGE_BYTES);
  assert.strictEqual(await processImageBuffer(boundary, 'photo.gif'), boundary);
  await assert.rejects(() => processImageBuffer(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'photo.png'), appError('IMAGE_TOO_LARGE'));
  await assert.rejects(() => processImageBuffer(Buffer.alloc(0), 'photo.png'), appError('IMAGE_FORMAT'));
  for (const folder of ['comments', 'after-sales', 'user/comments', 'user/after-sales']) {
    const userOutput = Buffer.alloc(15 * MAX_IMAGE_BYTES);
    assert.strictEqual(await processImageBuffer(userOutput, 'encoded.webp', folder), userOutput);
  }
  for (const folder of ['admin/products', 'admin/categories', 'home']) {
    const largeOutput = Buffer.alloc(15 * MAX_IMAGE_BYTES);
    assert.strictEqual(await processImageBuffer(largeOutput, 'encoded.webp', folder), largeOutput);
  }
  for (const folder of ['avatars', 'user/avatars']) {
    await assert.rejects(() => processImageBuffer(png, 'photo.png', folder), appError('FORBIDDEN'));
  }
  const calls = [];
  const runtime = { app: {
    downloadFile: async ({ fileID }) => { calls.push(['download', fileID]); return { fileContent: png }; },
    uploadFile: async ({ cloudPath, fileContent }) => { calls.push(['upload', cloudPath]); assert.strictEqual(fileContent, png); return { fileID: `cloud://test/${cloudPath}` }; },
    deleteFile: async ({ fileList }) => { calls.push(['delete', fileList[0]]); },
  } };
  const result = await processStagedImage(runtime, 'cloud://test/pending/user/comments/photo.png', ['user/comments']);
  assert.match(result.fileID, /^cloud:\/\/test\/user\/comments\/.+-photo\.png$/);
  assert.deepStrictEqual(calls.map((call) => call[0]), ['download', 'upload', 'delete']);
  for (const extension of ['png', 'PNG', 'PnG', 'GIF', 'avif', 'svg', 'heic']) {
    const staged = await processStagedImage(runtime, `cloud://test/pending/admin/categories/photo.${extension}`, ['admin/categories']);
    assert.ok(staged.fileID.endsWith(`-photo.${extension}`));
  }
  await assert.rejects(() => processStagedImage(runtime, 'cloud://test/pending/admin/products/photo.png', ['user/comments']), appError('FORBIDDEN'));
  await assert.rejects(() => processStagedImage(runtime, 'cloud://test/pending/user/avatars/photo.png', ['user/avatars']), appError('FORBIDDEN'));
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
        stockQuantity: 10,
        salePrice: 100,
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
  let transactionTail = Promise.resolve();

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
      limit(value) { return this.where({}).limit(value); },
      orderBy(field, direction) { return this.where({}).orderBy(field, direction); },
      doc(id) {
        const key = String(id);
        return {
          async get() {
            const value = bucket[key];
            return { data: value ? [value] : [] };
          },
          async set(value) {
            assert.strictEqual(Object.prototype.hasOwnProperty.call(value, '_id'), false, 'CloudBase rejects _id in doc.set data');
            bucket[key] = { ...value, _id: key };
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
        const matches = () => Object.values(bucket).filter((value) => Object.entries(query).every(([field, expected]) => {
          const actual = value[field];
          if (expected && expected.__op === 'in') return expected.value.includes(actual);
          if (expected && expected.__op === 'neq') return actual !== expected.value;
          if (expected && expected.__op === 'gte') return actual >= expected.value;
          if (expected && expected.__op === 'gt') return actual > expected.value;
          if (expected instanceof RegExp) return expected.test(String(actual || ''));
          if (expected && expected.__op === 'lte') return actual <= expected.value;
          return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
        }));
        let offset = 0;
        let max = Infinity;
        let sorting;
        const builder = {
          limit(value) { max = value; return builder; },
          skip(value) { offset = value; return builder; },
          orderBy(field, direction) { sorting = { field, direction }; return builder; },
          async get() {
            const rows = matches();
            if (sorting) rows.sort((a, b) => {
              const left = a[sorting.field], right = b[sorting.field];
              const compare = typeof left === 'number' && typeof right === 'number' ? left - right : String(left || '').localeCompare(String(right || ''));
              return compare * (sorting.direction === 'desc' ? -1 : 1);
            });
            return { data: rows.slice(offset, offset + max) };
          },
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
      command: Object.fromEntries(['in', 'neq', 'gte', 'gt', 'lte'].map((op) => [op, (value) => ({ __op: op, value })])),
      RegExp: ({ regexp, options }) => new RegExp(regexp, options),
      runTransaction(worker) {
        const result = transactionTail.then(async () => {
          const snapshot = JSON.parse(JSON.stringify(records));
          const writeCount = writes.length;
          try { return await worker({
          collection(name) {
            const ref = collection(name);
            return {
              ...ref,
              where() { throw new Error('where is not supported inside transactions'); },
            };
          },
          }); } catch (error) {
            for (const name of Object.keys(records)) {
              if (!snapshot[name]) delete records[name];
              else {
                for (const id of Object.keys(records[name])) delete records[name][id];
                Object.assign(records[name], snapshot[name]);
              }
            }
            writes.length = writeCount;
            throw error;
          }
        });
        transactionTail = result.catch(() => {});
        return result;
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
  assert.deepStrictEqual(page({ page: 3, pageSize: 10 }), { page: 3, pageSize: 10 });
  assert.deepStrictEqual(page({ pageNum: 4, pageSize: 5 }), { page: 1, pageSize: 5 });
}

async function testProductSearchAcrossNamesCategoriesAndSpecs() {
  const runtime = makeRuntime();
  runtime.records.categories = {
    drinks: { _id: 'drinks', name: '饮品', status: 'active' },
    coffee: { _id: 'coffee', name: '咖啡', parentId: 'drinks', status: 'active' },
    hidden: { _id: 'hidden', name: '隐藏分类', status: 'inactive' },
  };
  runtime.records.products = {
    arabica: { _id: 'arabica', title: 'Arabica豆', status: 'active', minSalePrice: 200, categoryIds: ['coffee'], specList: [{ specValueList: [{ specValueId: 'sku-1780000000010', specValue: '大份500g' }] }] },
    blend: { _id: 'blend', title: 'Blend豆', status: 'active', minSalePrice: 100, categoryIds: ['coffee'], specList: [{ specValueList: [{ specValueId: 'sku-1780000000020', specValue: '小份250g' }] }] },
    cup: { _id: 'cup', title: '陶瓷杯', status: 'active', minSalePrice: 300 },
    unavailable: { _id: 'unavailable', title: '咖啡大份', status: 'inactive', categoryIds: ['coffee'] },
  };
  runtime.records.skus = {
    'sku-1780000000010': { _id: 'sku-1780000000010', productId: 'arabica', specInfo: [{ specValue: '浅烘焙' }] },
    'sku-1780000000020': { _id: 'sku-1780000000020', productId: 'blend', specInfo: [{ specValue: '深烘焙' }] },
    removed: { _id: 'removed', productId: 'cup', specInfo: [{ specValue: '已删除规格' }], deletedByAdmin: true },
    unconfigured: { _id: 'unconfigured', productId: 'arabica', specInfo: [{ specValue: '未配置规格' }] },
  };
  const read = (keyword, extra = {}) => shopEndpoint({}, {}, runtime, 'products.list', { keyword, ...extra });
  const ids = (response) => response.items.map((item) => item._id);
  assert.deepStrictEqual(ids(await read('ARABICA')), ['arabica']);
  assert.deepStrictEqual(ids(await read('饮品')), ['arabica', 'blend']);
  assert.deepStrictEqual(ids(await read('咖啡')), ['arabica', 'blend']);
  assert.deepStrictEqual(ids(await read('500g')), ['arabica']);
  assert.deepStrictEqual(ids(await read('浅烘焙')), ['arabica']);
  assert.deepStrictEqual(ids(await read('咖啡 大份')), ['arabica']);
  assert.deepStrictEqual(ids(await read('咖啡大份')), ['arabica']);
  assert.deepStrictEqual(ids(await read('饮品 ARABICA 500g 浅烘焙')), ['arabica']);
  assert.deepStrictEqual(ids(await read('咖啡 陶瓷杯')), []);
  assert.deepStrictEqual(ids(await read('已删除规格')), []);
  assert.deepStrictEqual(ids(await read('未配置规格')), []);
  assert.deepStrictEqual(ids(await read('.*')), []);
  assert.deepStrictEqual(ids(await read('咖啡', { sort: 1, direction: 'asc' })), ['blend', 'arabica']);
  assert.deepStrictEqual(ids(await read('咖啡', { sort: 3 })), ['blend', 'arabica']);
  assert.deepStrictEqual(ids(await read('咖啡', { minPrice: 150 })), ['arabica']);
  const secondPage = await read('饮品', { page: 2, pageSize: 1 });
  assert.deepStrictEqual(ids(secondPage), ['blend']);
  assert.strictEqual(secondPage.total, 2);
  for (let index = 0; index < 105; index += 1) {
    const id = `extra-${index}`;
    runtime.records.products[id] = { _id: id, title: id, status: 'active', categoryIds: ['coffee'], minSalePrice: 1 };
  }
  const lastPage = await read('饮品', { page: 6, pageSize: 20 });
  assert.strictEqual(lastPage.total, 107);
  assert.strictEqual(lastPage.items.length, 7, 'cross-field filtering and totals cover every database page');
}

async function testProductListSortsByNameSkuAndPrice() {
  const runtime = makeRuntime();
  runtime.records.products = {
    a: { _id: 'a', title: 'Apple', status: 'active', minSalePrice: 300, sort: 99, createdAt: '2026-12-01' },
    b: { _id: 'b', title: 'Banana', status: 'active', minSalePrice: 100, sort: 1, createdAt: '2026-01-01', specList: [{ specValueList: [{ specValueId: 'sku-1780000000030' }] }] },
    c: { _id: 'c', title: 'Cherry', status: 'active', minSalePrice: 200, sort: 50, createdAt: '2026-06-01' },
    hidden: { _id: 'hidden', title: 'Hidden', status: 'inactive', minSalePrice: 1 },
  };
  runtime.records.skus = Object.fromEntries([
    ['a', 10], ['a', 20], ['b', 30], ['c', 15], ['hidden', 90],
  ].map(([productId, offset]) => {
    const skuId = `sku-${1780000000000 + offset}`;
    return [skuId, { _id: skuId, skuId, productId }];
  }));
  runtime.records.skus['sku-1780000000099'] = { _id: 'sku-1780000000099', productId: 'a', deletedByAdmin: true };
  runtime.records.skus['sku-1780000000098'] = { _id: 'sku-1780000000098', productId: 'b' };
  const ids = (response) => response.items.map((product) => product._id);
  const read = (data) => shopEndpoint({}, {}, runtime, 'products.list', data);
  assert.deepStrictEqual(ids(await read({ sort: 0 })), ['a', 'b', 'c']);
  assert.deepStrictEqual(ids(await read({ sort: 3 })), ['b', 'a', 'c']);
  const secondPage = await read({ sort: 3, page: 2, pageSize: 1 });
  assert.deepStrictEqual(ids(secondPage), ['a']);
  assert.strictEqual(secondPage.total, 3);
  assert.deepStrictEqual(ids(await read({ sort: 3, keyword: 'Apple' })), ['a']);
  assert.deepStrictEqual(ids(await read({ sort: 3, minPrice: 200 })), ['a', 'c']);
  assert.deepStrictEqual(ids(await read({ sort: 1, direction: 'asc' })), ['b', 'c', 'a']);
  assert.deepStrictEqual(ids(await read({ sort: 1, direction: 'desc' })), ['a', 'c', 'b']);
}

async function testSkuTimestampIdsAvoidCollisions() {
  const runtime = makeBatchRuntime();
  const context = { auth: { uid: 'admin-1' } };
  const originalNow = Date.now;
  const timestamp = 1780000000000;
  Date.now = () => timestamp;
  try {
    const occupied = `sku-${timestamp}`;
    runtime.records.skus[occupied] = { _id: occupied, skuId: occupied, productId: 'product-1', stockQuantity: 7 };
    const input = {
      title: '时间戳规格', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'],
      variants: [{ name: '大份', salePrice: 200 }, { name: '小份', salePrice: 100 }],
    };
    const first = await adminEndpoint({}, context, runtime, 'products.save', input);
    const second = await adminEndpoint({}, context, runtime, 'products.save', input);
    const ids = [first, second].flatMap((product) => product.specList[0].specValueList.map((value) => value.specValueId));
    assert.strictEqual(new Set(ids).size, 4);
    ids.forEach((id) => assert.match(id, /^sku-\d{13}$/));
    assert(!ids.includes(occupied));
    assert.strictEqual(runtime.records.skus[occupied].stockQuantity, 7);
  } finally {
    Date.now = originalNow;
  }
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
      id: created._id, title: '规格商品', primaryImage: 'cover.jpg', detailImages: Array(4).fill('detail.jpg'),
      variants: [{ name: '小份', salePrice: 1900 }],
    }),
    appError('INVALID_ARGUMENT'),
  );
  assert.strictEqual(created.specList[0].specValueList.length, 2);
  const skus = Object.values(runtime.records.skus).filter((sku) => sku.productId === created._id);
  assert.strictEqual(skus.length, 2);
  skus.forEach((sku) => assert.match(sku._id, /^sku-\d{13}$/));
  assert.strictEqual(new Set(skus.map((sku) => sku._id)).size, 2);
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
  assert.strictEqual(runtime.records.skus[removedSkuId].deletedByAdmin, true);
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'inactive' });
  assert.strictEqual(runtime.records.products[created._id].status, 'inactive');
  assert.strictEqual(runtime.records.skus[small._id].deletedByAdmin, false);
  assert.strictEqual(runtime.records.skus[removedSkuId].deletedByAdmin, true);
  await assert.rejects(() => shopEndpoint({}, {}, runtime, 'products.detail', { productId: created._id }));
  assert.deepStrictEqual((await shopEndpoint({}, {}, runtime, 'skus.list', { productId: created._id })).items, []);
  assert.deepStrictEqual((await shopEndpoint({}, {}, runtime, 'skus.list', {})).items.map((sku) => sku._id), ['sku-new']);
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'active' });
  assert.strictEqual(runtime.records.products[created._id].status, 'active');
  assert.strictEqual(runtime.records.skus[small._id].deletedByAdmin, false);
  assert.strictEqual(runtime.records.skus[removedSkuId].deletedByAdmin, true);
  assert.strictEqual(runtime.records.products[created._id].minSalePrice, 2400);
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'invalid' }), appError('INVALID_ARGUMENT'));
}

async function testProductSaveManagesSkuInventoryAndImagesWithoutSkuStatus() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const base = { title: '统一管理商品', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'] };
  const created = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base,
    variants: [
      { name: '小份', salePrice: 1900, stockQuantity: 8, skuImage: 'small.webp' },
      { name: '大份', salePrice: 3900, stockQuantity: 5 },
      { name: '第三种规格', salePrice: 900, stockQuantity: 2 },
  ],
  });
  assert.strictEqual(created.minSalePrice, 900);
  assert.strictEqual(created.maxSalePrice, 3900);
  const byName = Object.fromEntries(created.specList[0].specValueList.map((item) => [item.specValue, item.specValueId]));
  assert.strictEqual(runtime.records.skus[byName['小份']].stockQuantity, 8);
  assert.strictEqual(runtime.records.skus[byName['小份']].skuImage, 'small.webp');
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'inactive' });
  await adminEndpoint({}, context, runtime, 'products.update', { id: created._id, status: 'active' });
  await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [
      { skuId: byName['小份'], name: '小份', salePrice: 1900 },
      { skuId: byName['大份'], name: '大份', salePrice: 3900 },
      { skuId: byName['第三种规格'], name: '第三种规格', salePrice: 900 },
    ],
  });
  const publicDetail = await shopEndpoint({}, {}, runtime, 'products.detail', { productId: created._id });
  assert.strictEqual(publicDetail.product.minSalePrice, 900);
  assert.deepStrictEqual(publicDetail.skus.map((sku) => sku.stockQuantity).sort(), [2, 5, 8]);

  runtime.records.skus[byName['大份']].stockQuantity = 4; // 模拟编辑期间下单扣库存
  const updated = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [
      { skuId: byName['小份'], name: '小份', salePrice: 2200, stockQuantity: 7, expectedStockQuantity: 8, skuImage: '' },
      { skuId: byName['大份'], name: '大份', salePrice: 3900 },
    ],
  });
  assert.strictEqual(updated.minSalePrice, 2200);
  assert.strictEqual(updated.maxSalePrice, 3900);
  assert.strictEqual(runtime.records.skus[byName['小份']].stockQuantity, 7);
  assert.strictEqual(runtime.records.skus[byName['小份']].skuImage, '');
  assert.strictEqual(runtime.records.skus[byName['大份']].stockQuantity, 4);
  assert.strictEqual(runtime.records.skus[byName['大份']].deletedByAdmin, false);
  assert.strictEqual(runtime.records.skus[byName['第三种规格']].deletedByAdmin, true);

  const reactivated = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [
      { skuId: byName['小份'], name: '小份', salePrice: 2200 },
      { skuId: byName['大份'], name: '大份', salePrice: 1800 },
    ],
  });
  assert.strictEqual(reactivated.minSalePrice, 1800);
  assert.strictEqual(runtime.records.skus[byName['大份']].stockQuantity, 4);
  assert.strictEqual(runtime.records.skus[byName['大份']].deletedByAdmin, false);

  const writesBeforeConflict = runtime.writes.length;
  await assert.rejects(() => adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [{ skuId: byName['小份'], name: '小份', salePrice: 2200, stockQuantity: 6, expectedStockQuantity: 8 }],
  }), appError('CONFLICT'));
  assert.strictEqual(runtime.writes.length, writesBeforeConflict);
  assert.strictEqual(runtime.records.skus[byName['小份']].stockQuantity, 7);
}

async function testDeletingProductClearsHomeLinksWithoutRemovingSlots() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  runtime.records.products['product-1'].spuId = 'legacy-product-1';
  const payload = {
    searchText: '欢迎', bannerText: '公告',
    banners: [{ image: 'banner.jpg', productId: 'product-1' }],
    promos: [{ image: 'promo.jpg', productId: 'product-1' }, { image: 'other.jpg', productId: 'other-product' }],
    sections: [{ id: 'section-1', title: '推荐', productIds: ['product-1', 'other-product', 'product-1'] }],
  };
  runtime.records.homeContents = { 'home.page-config': { _id: 'home.page-config', payload } };
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'products.delete', { id: 'product-1' });
  const saved = runtime.records.homeContents['home.page-config'].payload;
  assert.deepStrictEqual(saved.banners, [{ image: 'banner.jpg', productId: '' }]);
  assert.deepStrictEqual(saved.promos, [{ image: 'promo.jpg', productId: '' }, { image: 'other.jpg', productId: 'other-product' }]);
  assert.deepStrictEqual(saved.sections[0].productIds, ['', 'other-product', '']);
  assert.strictEqual(saved.searchText, '欢迎');
  runtime.records.homeContents['home.page-config'].payload = payload;
  const repaired = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'home.clearUnavailableLinks', { id: 'home.page-config' });
  assert.strictEqual(repaired.payload.banners[0].productId, '');
  assert.strictEqual(repaired.payload.promos[0].productId, '');
  const reread = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'home.get', { id: 'home.page-config' });
  assert.deepStrictEqual(reread.payload, repaired.payload);
  assert.strictEqual(runtime.records.homeContents['home.page-config'].payload.banners[0].productId, '');
  assert.strictEqual(runtime.records.products['product-1'].deletedByAdmin, true);

  runtime.records.products['product-1'].deletedByAdmin = false;
  runtime.records.products['product-1'].status = 'active';
  runtime.records.homeContents['home.page-config'].payload = payload;
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'products.update', { id: 'product-1', status: 'inactive' });
  assert.strictEqual(runtime.records.homeContents['home.page-config'].payload.banners[0].productId, '');
  assert.strictEqual(runtime.records.homeContents['home.page-config'].payload.promos[0].productId, '');
  assert.deepStrictEqual(runtime.records.homeContents['home.page-config'].payload.sections[0].productIds, ['', 'other-product', '']);
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'products.update', { id: 'product-1', status: 'active' });
  assert.strictEqual(runtime.records.homeContents['home.page-config'].payload.banners[0].productId, '');
  assert.strictEqual(runtime.records.homeContents['home.page-config'].payload.promos[0].productId, '');
}

async function testHomeCleanupPreservesActiveLegacyProductLinks() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  runtime.records.products['product-1'].spuId = 'legacy-product-1';
  const payload = {
    searchText: '欢迎', bannerText: '公告',
    banners: [{ image: 'banner.jpg', productId: 'legacy-product-1' }],
    promos: [{ image: 'promo.jpg', productId: 'legacy-product-1' }, { image: '', productId: '' }],
    sections: [{ id: 'section-1', title: '推荐', productIds: ['legacy-product-1', 'product-1', 'missing-product'] }],
  };
  runtime.records.homeContents = { 'home.page-config': { _id: 'home.page-config', payload } };
  const call = (action, data) => adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, action, data);
  await assert.rejects(() => call('products.get', { id: 'legacy-product-1' }), appError('NOT_FOUND'));
  assert.strictEqual((await call('products.get', { id: 'product-1' }))._id, 'product-1');
  await assert.rejects(() => call('products.get', { id: 'missing-product' }), appError('NOT_FOUND'));
  for (const action of ['home.get', 'home.clearUnavailableLinks']) {
    const result = await call(action, { id: 'home.page-config' });
    assert.deepStrictEqual(result.payload.banners, [{ image: 'banner.jpg', productId: '' }]);
    assert.deepStrictEqual(result.payload.promos, [{ image: 'promo.jpg', productId: '' }, { image: '', productId: '' }]);
    assert.deepStrictEqual(result.payload.sections[0].productIds, ['', 'product-1', '']);
  }
  for (const patch of [{ status: 'inactive' }, { status: 'active', deletedByAdmin: true }]) {
    Object.assign(runtime.records.products['product-1'], patch);
    runtime.records.homeContents['home.page-config'].payload = payload;
    const result = await call('home.clearUnavailableLinks', { id: 'home.page-config' });
    assert.strictEqual(result.payload.banners[0].productId, '');
    assert.strictEqual(result.payload.promos[0].productId, '');
    assert.deepStrictEqual(result.payload.sections[0].productIds, ['', '', '']);
    assert.strictEqual(result.payload.banners[0].image, 'banner.jpg');
  }
}

async function testInactiveProductsArePinnedBeforePagination() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  runtime.records.products['product-1'].status = 'active';
  runtime.records.products['product-1'].updatedAt = '2026-01-01';
  runtime.records.products['inactive-product'] = { _id: 'inactive-product', title: '已下架商品', status: 'inactive', updatedAt: '2020-01-01' };
  runtime.records.products['deleted-product'] = { _id: 'deleted-product', status: 'inactive', deletedByAdmin: true };
  const result = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'products.list', { page: 1, pageSize: 1, inactiveFirst: true });
  assert.strictEqual(result.items[0]._id, 'inactive-product');
  assert.strictEqual(result.total, 2);
}

async function testSkuInventoryCanBeSetSeparatelyWithoutProductSaveResettingIt() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', role: 'admin', status: 'active' } };
  const context = { auth: { uid: 'admin-1' } };
  const base = { title: '分开管理库存', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'] };
  const created = await adminEndpoint({}, context, runtime, 'products.save', {
    ...base,
    variants: [{ name: '标准', salePrice: 1000 }],
  });
  const skuId = created.specList[0].specValueList[0].specValueId;
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 999);

  await adminEndpoint({}, context, runtime, 'inventory.adjust', { skuId, stockQuantity: 10, expectedStockQuantity: 999 });
  assert.strictEqual(runtime.records.skus[skuId].stockQuantity, 10);
  assert.strictEqual((await shopEndpoint({}, {}, runtime, 'products.detail', { productId: created._id })).skus[0].stockQuantity, 10);

  await adminEndpoint({}, context, runtime, 'products.save', {
    ...base, id: created._id,
    variants: [{ skuId, name: '标准版', salePrice: 1200 }],
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
    runtime.records.skus[skuId] = { _id: skuId, skuId, productId: 'product-1', spuId: 'product-1', stockQuantity: index, salePrice: 1000 };
    return { skuId, name: `规格 ${index}`, salePrice: 1000 };
  });
  const listed = await adminEndpoint({}, context, runtime, 'skus.list', { productId: 'product-1' });
  assert.strictEqual(listed.items.length, 101);
  await adminEndpoint({}, context, runtime, 'products.save', {
    id: 'product-1', title: '测试商品', primaryImage: 'cover.jpg', detailImages: ['detail.jpg'], variants,
  });
  assert.strictEqual(runtime.records.skus['sku-99'].stockQuantity, 99);
  assert.strictEqual(runtime.records.skus['sku-99'].deletedByAdmin, false);
}

async function testMergedSkuQuantityIsCapped() {
  assert.deepStrictEqual(normalizeOrderItems([{ skuId: 'sku-a', quantity: 99 }]), [{ skuId: 'sku-a', quantity: 99 }]);
  assert.throws(() => normalizeOrderItems([{ skuId: 'sku-a', quantity: 100 }]), appError('INVALID_ARGUMENT'));
  const duplicateItems = [{ skuId: 'sku-a', quantity: 50 }, { skuId: 'sku-a', quantity: 50 }];
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
  for (const skuIds of [
    ['sku-before', 'sku-old', 'sku-after'],
    ['sku-new', 'sku-before', 'sku-old', 'sku-after'],
    ['sku-before', 'sku-old', 'sku-after', 'sku-new'],
  ]) {
    runtime.records.carts['user-1'].items = skuIds.map((skuId) => ({ skuId, quantity: 1, isSelected: true }));
    const replaced = await shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime,
      'cart.replaceSku', { oldSkuId: 'sku-old', newSkuId: 'sku-new', quantity: 1 });
    assert.deepStrictEqual(replaced.items.map((item) => item.skuId), ['sku-before', 'sku-new', 'sku-after']);
  }
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

async function testPaidOrdersCannotBeCancelled() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const input = { requestKey: 'refund-only-test', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 2 }] };
  const call = (action, data) => shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, action, data);
  const order = await call('orders.create', input);
  const stock = runtime.records.skus['sku-new'].stockQuantity;
  await assert.rejects(call('orders.cancel', { orderId: order._id }), appError('INVALID_ARGUMENT'));
  assert.strictEqual(runtime.records.orders[order._id].status, 'paid');
  assert.strictEqual(runtime.records.orders[order._id].paymentStatus, 'paid');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stock);
  const claim = await call('afterSales.create', {
    orderId: order._id, type: 20, reason: '申请退款',
    rightsItem: [{ skuId: 'sku-new', rightsQuantity: 2 }],
  });
  assert.strictEqual(claim.status, 'pending_review');
  assert.strictEqual(runtime.records.orders[order._id].status, 'paid');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stock);
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  assert.strictEqual(runtime.records.orders[order._id].status, 'refunded');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stock + 2);
  const visible = await call('orders.list', { orderStatus: 60 });
  assert.strictEqual(visible.items.length, 1);
  assert.strictEqual(visible.items[0].status, 'refunded');
  assert.strictEqual((await call('orders.create', input))._id, order._id);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stock + 2);
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
  assert.match(result.orderNo, /^\d{13}[1-9]\d$/);
  assert.strictEqual(result._id, result.orderNo);
  assert.strictEqual(result.status, 'paid');
  assert.strictEqual(result.paymentStatus, 'paid');
  assert.strictEqual(result.payment.mode, 'simulated');
  assert.strictEqual(result.paymentAmount, result.totalAmount);
  assert.strictEqual(Object.hasOwn(result, 'expiresAt'), false);
  assert.strictEqual(Object.hasOwn(runtime.records.orders[result._id], 'expiresAt'), false);
  assert.strictEqual(STATUS.pendingPayment, undefined);
  assert.strictEqual(result.inventoryReserved, true);
  assert.strictEqual(runtime.writes.some((write) => write.operation === 'update' && write.collection === 'skus'), true);
}

async function testOrderPreviewAllowsMissingAddressWithoutCreatingAnOrder() {
  const runtime = makeRuntime();
  const context = { auth: { uid: 'user-1' } };
  const input = { items: [{ skuId: 'sku-new', quantity: 2 }], useCart: false };
  const preview = await shopEndpoint({}, context, runtime, 'orders.preview', input);
  assert.strictEqual(preview.addressSnapshot, null);
  assert.strictEqual(preview.totalAmount, 200);
  assert.strictEqual(preview.items[0].quantity, 2);
  assert.strictEqual(runtime.writes.length, 0);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);
  assert.deepStrictEqual(runtime.records.orders, {});

  const withAddress = await shopEndpoint({}, context, runtime, 'orders.preview', { ...input, addressId: 'address-1' });
  assert.strictEqual(withAddress.addressSnapshot._id, 'address-1');
  runtime.records.addresses['address-other'] = { _id: 'address-other', userId: 'user-2' };
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.preview', {
    ...input, addressId: 'address-other',
  }), appError('FORBIDDEN'));
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.preview', {
    ...input, addressId: 'missing-address',
  }), appError('NOT_FOUND'));
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.preview', {
    items: [{ skuId: 'sku-new', quantity: 11 }],
  }), appError('OUT_OF_STOCK'));
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.create', {
    ...input, requestKey: 'no-address', requireAddress: false,
  }), appError('ADDRESS_REQUIRED'));
  assert.deepStrictEqual(runtime.records.orders, {});
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);
}

async function testOrderCreationRechecksProductStatus() {
  const runtime = makeRuntime();
  const originalTransaction = runtime.db.runTransaction.bind(runtime.db);
  let transactionCount = 0;
  runtime.db.runTransaction = (worker) => {
    transactionCount += 1;
    // 首次事务预留幂等订单 ID；第二次事务才确认商品并创建订单。
    if (transactionCount === 2) runtime.records.products['product-1'].status = 'inactive';
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
  runtime.records.skus['sku-new'].stockQuantity = 3;
  runtime.records.skus['sku-zero'] = { ...runtime.records.skus['sku-new'], _id: 'sku-zero', skuId: 'sku-zero', stockQuantity: 0 };
  runtime.records.skus['sku-normal'] = { ...runtime.records.skus['sku-new'], _id: 'sku-normal', skuId: 'sku-normal', stockQuantity: 4 };
  const result = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'dashboard.summary', {});
  assert.strictEqual(result.metrics.productCount, 26);
  assert.deepStrictEqual(result.inventoryWarnings.map((item) => item.stockQuantity), [0, 3]);
  assert.strictEqual(result.inventoryWarnings[0].productId, 'product-1');
  runtime.records.products['product-1'].deletedByAdmin = true;
  const afterDelete = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'dashboard.summary', {});
  assert.strictEqual(afterDelete.metrics.productCount, 25);
  assert.deepStrictEqual(afterDelete.inventoryWarnings, []);
  Object.values(runtime.records.products).forEach((product) => { product.deletedByAdmin = true; });
  const empty = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'dashboard.summary', {});
  assert.strictEqual(empty.metrics.productCount, 0);
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
  const sections = Array.from({ length: 4 }, (_, index) => ({ ...config.sections[0], id: `section-${index}` }));
  assert.strictEqual(validateHomeConfig({ ...config, sections }).sections.length, 4);
  assert.throws(() => validateHomeConfig({ ...config, sections: [...sections, { ...config.sections[0], id: 'section-4' }] }), appError('INVALID_ARGUMENT'));
  assert.strictEqual(validateHomeConfig({ ...config, banners: Array(4).fill(blankLink) }).banners.length, 4);
  assert.deepStrictEqual(validateHomeConfig({ ...config, banners: [] }).banners, []);
  assert.throws(() => validateHomeConfig({ ...config, banners: Array(5).fill(blankLink) }), appError('INVALID_ARGUMENT'));

  const runtime = makeRuntime();
  runtime.records.homeContents = {
    'legacy-banner': { _id: 'legacy-banner', slot: 'home.banner.1', type: 'banner', image: 'legacy.jpg', status: 'active', sort: 0 },
    'home.page-config': { _id: 'home.page-config', slot: 'home.page-config', type: 'pageConfig', payload: config, status: 'active', sort: -100 },
  };
  const result = await shopEndpoint({}, {}, runtime, 'home.get', {});
  assert.strictEqual(result.items, undefined, 'old banner records are not returned');
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
    categoryIds: [child._id], variants: [{ skuId: 'sku-new', name: '规格', salePrice: 100 }],
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
  assert.deepStrictEqual(publicCategories.items.map((item) => item._id).sort(), [parent._id, child._id].sort());
  assert.strictEqual(publicCategories.items.find((item) => item._id === child._id).image, '');
  const deleted = await adminEndpoint({}, context, runtime, 'categories.delete', { id: parent._id });
  assert.deepStrictEqual(deleted.removedIds, [parent._id, child._id]);
  assert.strictEqual(runtime.records.categories[parent._id].status, 'inactive');
  assert.strictEqual(runtime.records.categories[child._id].status, 'inactive');
  assert.deepStrictEqual(runtime.records.products['product-1'].categoryIds, []);
  assert.strictEqual(runtime.records.products['product-1'].categoryId, child._id, 'unused old fields are not migrated');
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
  assert.deepStrictEqual(runtime.records.products['legacy-product'].categoryIds, []);
  assert.strictEqual(runtime.records.products['legacy-product'].categoryId, nextParent._id, 'old category fields are not migrated');
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

function receivedOrder(items = [{ productId: 'product-1', skuId: 'sku-new', quantity: 2, unitPrice: 100, amount: 200 }]) {
  const amount = items.reduce((sum, item) => sum + item.amount, 0);
  return { _id: 'order-1', orderNo: 'order-1', userId: 'user-1', status: 'received', fulfillmentStatus: 'received', items, totalAmount: amount, paymentAmount: amount, paymentStatus: 'paid', payment: { mode: 'simulated', amount, status: 'paid' }, refundAmount: 0, refundedQuantities: {}, pendingRefundAmount: 0, pendingRefundQuantities: {}, afterSaleIds: [] };
}

async function testOnlyActiveAdminsAreAllowed() {
  const runtime = makeRuntime();
  const member = { _id: 'admin-1', roles: ['admin'], status: 'active' };
  runtime.records.adminMembers = { 'admin-1': member };
  const context = { auth: { uid: 'admin-1' } };
  await requireAdmin(runtime.db, {}, context, 'catalog');
  for (const status of ['inactive', 'disabled', '', undefined]) {
    member.status = status;
    await assert.rejects(() => requireAdmin(runtime.db, {}, context, 'catalog'), appError('FORBIDDEN'));
  }
  member.status = 'active'; member.enabled = false;
  await assert.rejects(() => requireAdmin(runtime.db, {}, context, 'catalog'), appError('FORBIDDEN'));
}

async function testOrderPricesAndSnapshotsAreConfirmedInTransaction() {
  const runtime = makeRuntime();
  const transaction = runtime.db.runTransaction;
  runtime.db.runTransaction = (worker) => {
    runtime.records.skus['sku-new'].salePrice = 900;
    runtime.records.products['product-1'].title = '最新商品名称';
    runtime.records.addresses['address-1'].detail = '最新地址';
    return transaction(worker);
  };
  const created = await shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, 'orders.create', {
    items: [{ skuId: 'sku-new', quantity: 2 }], addressId: 'address-1', requestKey: 'price-race',
  });
  assert.strictEqual(created.totalAmount, 1800);
  assert.strictEqual(created.items[0].unitPrice, 900);
  assert.strictEqual(created.items[0].productSnapshot.title, '最新商品名称');
  assert.strictEqual(created.addressSnapshot.detail, '最新地址');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 8);
}

async function testHistoricalPendingPaymentOrdersRemainUntouched() {
  const runtime = makeRuntime();
  const legacy = { ...receivedOrder(), status: 'pending_payment', inventoryReserved: true, expiresAt: '2020-01-01T00:00:00.000Z' };
  runtime.records.orders['order-1'] = legacy;
  runtime.records.skus['sku-new'].stockQuantity = 8;
  const detail = await shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, 'orders.detail', { orderId: 'order-1' });
  assert.strictEqual(detail.status, 'pending_payment');
  assert.strictEqual(detail.expiresAt, legacy.expiresAt);
  assert.strictEqual(runtime.records.orders['order-1'].status, 'pending_payment');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 8);
  assert.strictEqual(runtime.writes.length, 0, 'reading a historical unpaid order must not migrate or alter it');
  assert.strictEqual(STATUS.pendingPayment, undefined);
  assert.strictEqual(ORDER_STATUS.includes('pending_payment'), false);
}

async function testCommentsAreAtomicPrivateAndQueryableByOwner() {
  const runtime = makeRuntime();
  runtime.records.orders['order-1'] = receivedOrder();
  const context = { auth: { uid: 'user-1' } };
  const input = { orderId: 'order-1', productId: 'product-1', content: '真实评价', images: ['cloud://test/user/comments/image.webp'] };
  const results = await Promise.allSettled([
    shopEndpoint({}, context, runtime, 'comments.create', input),
    shopEndpoint({}, context, runtime, 'comments.create', input),
  ]);
  assert.strictEqual(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.strictEqual(Object.keys(runtime.records.comments).length, 1);
  const mine = await shopEndpoint({}, context, runtime, 'comments.list', { orderId: 'order-1', mineOnly: true });
  assert.strictEqual(mine.items[0].status, 'pending_review');
  assert.strictEqual(mine.items[0].userId, 'user-1');
  assert.strictEqual((await shopEndpoint({}, {}, runtime, 'comments.list', {})).items.length, 0);
  runtime.records.comments[mine.items[0]._id].status = 'active';
  const publicResult = await shopEndpoint({}, {}, runtime, 'comments.list', {});
  for (const field of ['userId', 'orderId', 'orderNo']) assert.strictEqual(publicResult.items[0][field], undefined);
  assert.strictEqual(publicResult.items[0].content, '真实评价');
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'other-user' } }, runtime, 'comments.list', { orderId: 'order-1' }), appError('FORBIDDEN'));
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.detail', { orderId: 'order-1' })).hasPendingComments, false);
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.count', {})).items.find((item) => item.tabType === 50).orderNum, 0);
}

async function testReceivedOrdersAndPendingCommentPagination() {
  const runtime = makeRuntime();
  for (let i = 0; i < 12; i += 1) runtime.records.orders[`order-${i}`] = { ...receivedOrder(), _id: `order-${i}`, createdAt: String(i).padStart(2, '0') };
  runtime.records.orders.shipped = { ...receivedOrder(), _id: 'shipped', status: 'shipped' };
  const context = { auth: { uid: 'user-1' } };
  const received = await shopEndpoint({}, context, runtime, 'orders.list', { orderStatus: 50 });
  assert.strictEqual(received.total, 12);
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.list', { orderStatus: 40 })).items.length, 1);
  for (let i = 4; i < 12; i += 1) runtime.records.comments[`comment-${i}`] = {
    _id: `comment-${i}`, userId: 'user-1', orderId: `order-${i}`, productId: 'product-1', status: 'pending_review',
  };
  const pending = await shopEndpoint({}, context, runtime, 'orders.list', { orderStatus: 50, pendingCommentOnly: true, pageSize: 2 });
  assert.strictEqual(pending.total, 4);
  assert.strictEqual(pending.items.length, 2);
  assert.strictEqual(pending.items[0]._id, 'order-3');
  const counts = await shopEndpoint({}, context, runtime, 'orders.count', {});
  assert.strictEqual(counts.items.find((item) => item.tabType === 50).orderNum, 4);
}

async function testImageFilterPrecedesCommentPagination() {
  const runtime = makeRuntime();
  runtime.records.comments = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`comment-${i}`, {
    _id: `comment-${i}`, status: 'active', productId: 'product-1', createdAt: i, hasImage: i === 0, images: i === 0 ? ['cloud://image'] : [],
  }]));
  const result = await shopEndpoint({}, {}, runtime, 'comments.list', { productId: 'product-1', hasImage: true, page: 1, pageSize: 10 });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.total, 1);
  assert.strictEqual(result.items[0]._id, 'comment-0');
}

async function testAfterSalesValidateSkuQuantityAmountAndConcurrentClaims() {
  const runtime = makeRuntime();
  const items = [
    { productId: 'product-1', skuId: 'sku-A', quantity: 2, unitPrice: 100, amount: 200 },
    { productId: 'product-1', skuId: 'sku-B', quantity: 3, unitPrice: 200, amount: 600 },
  ];
  runtime.records.orders['order-1'] = receivedOrder(items);
  const context = { auth: { uid: 'user-1' } };
  const input = { orderId: 'order-1', type: 20, reason: '质量问题', rightsItem: [{ skuId: 'sku-B', rightsQuantity: 1 }], refundRequestAmount: 200,
    images: Array.from({ length: 3 }, (_, index) => `cloud://test/user/after-sales/${index}.webp`) };
  for (const invalid of [
    { ...input, rightsItem: [{ skuId: 'unknown', rightsQuantity: 1 }] },
    { ...input, rightsItem: [{ skuId: 'sku-B', rightsQuantity: 4 }] },
    { ...input, refundRequestAmount: 201 },
    { ...input, type: 'invalid' },
    { ...input, images: [...input.images, 'cloud://test/user/after-sales/extra.webp'] },
  ]) await assert.rejects(() => shopEndpoint({}, context, runtime, 'afterSales.create', invalid), appError('INVALID_ARGUMENT'));
  assert.strictEqual(Object.keys(runtime.records.afterSales || {}).length, 0);
  const results = await Promise.allSettled([
    shopEndpoint({}, context, runtime, 'afterSales.create', input),
    shopEndpoint({}, context, runtime, 'afterSales.create', input),
  ]);
  assert.strictEqual(results.filter((result) => result.status === 'fulfilled').length, 1);
  const saved = Object.values(runtime.records.afterSales)[0];
  assert.strictEqual(saved.images.length, 3);
  assert.strictEqual(saved.items[0].skuId, 'sku-B');
  assert.strictEqual(saved.items[0].quantity, 1);
  assert.strictEqual(saved.amount, 200);
  saved.status = 'refunded';
  runtime.records.orders['order-1'].refundAmount = 200;
  runtime.records.orders['order-1'].refundedQuantities = { 'sku-B': 1 };
  runtime.records.orders['order-1'].pendingRefundAmount = 0;
  runtime.records.orders['order-1'].pendingRefundQuantities = {};
  const second = await shopEndpoint({}, context, runtime, 'afterSales.create', input);
  runtime.records.afterSales[second._id].status = 'refunded';
  runtime.records.orders['order-1'].refundAmount = 400;
  runtime.records.orders['order-1'].refundedQuantities = { 'sku-B': 2 };
  runtime.records.orders['order-1'].pendingRefundAmount = 0;
  runtime.records.orders['order-1'].pendingRefundQuantities = {};
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'afterSales.create', {
    ...input, rightsItem: [{ skuId: 'sku-B', rightsQuantity: 2 }], refundRequestAmount: 400,
  }), appError('INVALID_ARGUMENT'));
}

async function testSimulatedPaymentAddressChangeAndFullRefundRestoreInventory() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', roles: ['admin'], status: 'active' } };
  const user = { auth: { uid: 'user-1' } };
  const admin = { auth: { uid: 'admin-1' } };
  const created = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'sim-refund', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  assert.strictEqual(created.status, 'paid');
  assert.strictEqual(created.payment.mode, 'simulated');
  assert.strictEqual(created.paymentAmount, 100);
  const repeated = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'sim-refund', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  assert.strictEqual(repeated._id, created._id);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);

  runtime.records.addresses['address-2'] = { _id: 'address-2', userId: 'user-1', receiver: '新收件人', phone: '13900000000', detail: '新地址' };
  const moved = await shopEndpoint({}, user, runtime, 'orders.updateAddress', { orderId: created._id, addressId: 'address-2' });
  assert.strictEqual(moved.addressSnapshot._id, 'address-2');
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'other-user' } }, runtime, 'orders.updateAddress', { orderId: created._id, addressId: 'address-1' }), appError('FORBIDDEN'));

  const application = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created._id, type: 20, reason: '不想要了', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'orders.updateAddress', { orderId: created._id, addressId: 'address-1' }), appError('CONFLICT'));
  const refunded = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: application._id, status: 'approved' });
  assert.strictEqual(refunded.status, 'refunded');
  assert.strictEqual(refunded.refundMode, 'simulated');
  assert.strictEqual(runtime.records.orders[created._id].status, 'refunded');
  assert.strictEqual(runtime.records.orders[created._id].paymentStatus, 'refunded');
  assert.strictEqual(runtime.records.orders[created._id].refundAmount, 100);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);
  assert.strictEqual(runtime.records.skus['sku-new'].soldQuantity, 0);
  const repeatedRefund = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: application._id, status: 'approved' });
  assert.strictEqual(repeatedRefund.status, 'refunded');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);
}

async function testCartCheckoutRetryAfterAtomicRemovalIsIdempotent() {
  const runtime = makeRuntime();
  runtime.records.skus['sku-other'] = { ...runtime.records.skus['sku-new'], _id: 'sku-other', skuId: 'sku-other', stockQuantity: 4 };
  runtime.records.carts['user-1'] = {
    _id: 'user-1', userId: 'user-1', items: [
      { skuId: 'sku-new', quantity: 2, isSelected: true },
      { skuId: 'sku-other', quantity: 1, isSelected: false },
    ],
  };
  const context = { auth: { uid: 'user-1' } };
  const input = {
    requestKey: 'cart-retry', useCart: true, addressId: 'address-1',
    items: [{ skuId: 'sku-new', quantity: 2 }],
  };
  const created = await shopEndpoint({}, context, runtime, 'orders.create', input);
  assert.strictEqual(runtime.records.carts['user-1'].items.length, 1);
  assert.strictEqual(runtime.records.carts['user-1'].items[0].skuId, 'sku-other');
  const stockAfterFirst = runtime.records.skus['sku-new'].stockQuantity;
  const retried = await shopEndpoint({}, context, runtime, 'orders.create', input);
  assert.strictEqual(retried._id, created._id);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, stockAfterFirst);
  const retryWithoutItems = await shopEndpoint({}, context, runtime, 'orders.create', { requestKey: 'cart-retry', useCart: true, addressId: 'address-1' });
  assert.strictEqual(retryWithoutItems._id, created._id);
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.create', {
    ...input, items: [{ skuId: 'sku-other', quantity: 1 }],
  }), appError('IDEMPOTENCY_CONFLICT'));
}

function makeBatchRuntime() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  runtime.records.products['product-2'] = { _id: 'product-2', spuId: 'product-2', title: '第二个商品', status: 'active' };
  runtime.records.skus['sku-second'] = { _id: 'sku-second', skuId: 'sku-second', productId: 'product-2', stockQuantity: 6, salePrice: 250 };
  runtime.records.skus['sku-variant'] = { _id: 'sku-variant', skuId: 'sku-variant', productId: 'product-1', stockQuantity: 5, salePrice: 150 };
  return runtime;
}

async function testMultiProductCheckoutIsAtomicAndIdempotent() {
  const runtime = makeBatchRuntime();
  runtime.records.carts['user-1'].items = [
    { skuId: 'sku-new', quantity: 2, isSelected: true },
    { skuId: 'sku-second', quantity: 2, isSelected: true },
    { skuId: 'sku-variant', quantity: 1, isSelected: true },
    { skuId: 'sku-unselected', quantity: 1, isSelected: false },
  ];
  const context = { auth: { uid: 'user-1' } };
  const input = { requestKey: 'multi-product', useCart: true, addressId: 'address-1', items: [
    { skuId: 'sku-new', quantity: 1 }, { skuId: 'sku-second', quantity: 2 },
    { skuId: 'sku-new', quantity: 1 }, { skuId: 'sku-variant', quantity: 1 },
  ] };
  const [created, concurrent] = await Promise.all([
    shopEndpoint({}, context, runtime, 'orders.create', input),
    shopEndpoint({}, context, runtime, 'orders.create', input),
  ]);
  assert.strictEqual(created.orderCount, 3, 'different SKUs, including variants, get independent orders');
  assert.deepStrictEqual(concurrent.orderIds, created.orderIds);
  assert.strictEqual(new Set(created.orderIds).size, 3);
  assert.strictEqual(Object.keys(runtime.records.orders).length, 3, 'no extra combined parent order');
  assert.strictEqual(created.checkoutTotalAmount, 850);
  assert.deepStrictEqual(created.orders.map((order) => order.totalAmount), [200, 500, 150]);
  for (const order of created.orders) {
    assert.match(order.orderNo, /^\d{13}[1-9]\d$/);
    assert.strictEqual(order.items.length, 1);
    assert.strictEqual(order.checkoutId, created._id);
    assert.strictEqual(order.payment.amount, order.totalAmount);
    assert.strictEqual(order.payment.transactionId, `sim_${order._id}`);
    assert.strictEqual(order.addressSnapshot.detail, '测试地址');
  }
  assert.deepStrictEqual(['sku-new', 'sku-second', 'sku-variant'].map((id) => runtime.records.skus[id].stockQuantity), [8, 4, 4]);
  assert.deepStrictEqual(runtime.records.carts['user-1'].items.map((item) => item.skuId), ['sku-unselected']);
  const retry = await shopEndpoint({}, context, runtime, 'orders.create', { requestKey: input.requestKey, useCart: true, addressId: 'address-1' });
  assert.deepStrictEqual(retry.orderIds, created.orderIds, 'retry without cart items still returns every order');
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.create', { ...input, items: [{ skuId: 'sku-new', quantity: 1 }] }), appError('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.create', { ...input, addressId: 'different' }), appError('IDEMPOTENCY_CONFLICT'));
  const checkout = await shopEndpoint({}, context, runtime, 'orders.checkout', { checkoutId: created.checkoutId });
  assert.deepStrictEqual(checkout.orderIds, created.orderIds);
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'user-2' } }, runtime, 'orders.checkout', { checkoutId: created.checkoutId }), appError('FORBIDDEN'));
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.list', {})).total, 3);
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.count', {})).items.find((item) => item.tabType === 10).orderNum, 3);

  // A refund belongs only to its SKU order, not to the whole checkout.
  const second = created.orders[1];
  const claim = await shopEndpoint({}, context, runtime, 'afterSales.create', {
    orderId: second._id, type: 20, reason: '仅退款第二个商品', rightsItem: [{ skuId: 'sku-second', rightsQuantity: 2 }],
  });
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  assert.strictEqual(runtime.records.orders[second._id].status, 'refunded');
  assert.strictEqual(runtime.records.orders[created.orderIds[0]].status, 'paid');
  assert.strictEqual(runtime.records.orders[created.orderIds[2]].status, 'paid');
  assert.strictEqual(runtime.records.skus['sku-second'].stockQuantity, 6);
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.create', input)).orderCount, 3);
  assert.strictEqual(Object.keys(runtime.records.orders).length, 3, 'refund cannot recreate a checkout');
}

async function testSplitCheckoutRollbackAndLegacyCompatibility() {
  const runtime = makeBatchRuntime();
  const context = { auth: { uid: 'user-1' } };
  const input = { requestKey: 'split-rollback', useCart: true, addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 2 }, { skuId: 'sku-second', quantity: 2 }] };
  runtime.records.carts['user-1'].items = input.items.map((item) => ({ ...item, isSelected: true }));
  const transaction = runtime.db.runTransaction;
  let calls = 0;
  runtime.db.runTransaction = (worker) => {
    if (++calls === 2) runtime.records.skus['sku-second'].stockQuantity = 0;
    return transaction(worker);
  };
  await assert.rejects(() => shopEndpoint({}, context, runtime, 'orders.create', input), appError('OUT_OF_STOCK'));
  assert.deepStrictEqual(runtime.records.orders, {});
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10, 'first SKU deduction rolls back if a later SKU fails');
  assert.strictEqual(runtime.records.carts['user-1'].items.length, 2);
  const reservedId = Object.values(runtime.records.orderRequests).find((request) => request.requestKey === input.requestKey).orderId;
  runtime.records.skus['sku-second'].stockQuantity = 6;
  runtime.db.runTransaction = transaction;
  const created = await shopEndpoint({}, context, runtime, 'orders.create', input);
  assert.strictEqual(created.checkoutId, reservedId);
  const claim = await shopEndpoint({}, context, runtime, 'afterSales.create', {
    orderId: created.orderIds[1], type: 20, reason: '申请退款', rightsItem: [{ skuId: runtime.records.orders[created.orderIds[1]].items[0].skuId, rightsQuantity: 1 }],
  });
  await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  assert.strictEqual(Object.values(runtime.records.orderRequests).find((request) => request.requestKey === input.requestKey).orderId, reservedId);
  assert.strictEqual(runtime.records.orders[reservedId].status, 'paid');
  assert.strictEqual((await shopEndpoint({}, context, runtime, 'orders.create', input)).checkoutId, reservedId);

  const legacyRuntime = makeBatchRuntime();
  const legacyKey = 'legacy-combined';
  const id = `ord_${require('crypto').createHash('sha256').update(`user-1:${legacyKey}`).digest('hex').slice(0, 32)}`;
  const legacy = { _id: id, orderNo: id, userId: 'user-1', status: 'paid', paymentStatus: 'paid', items: input.items, totalAmount: 700 };
  legacyRuntime.records.orders[id] = legacy;
  const repeated = await shopEndpoint({}, context, legacyRuntime, 'orders.create', { ...input, requestKey: legacyKey });
  assert.notStrictEqual(repeated._id, id, 'old hashed IDs no longer resolve current requests');
  assert.strictEqual(repeated.orders.length, 2);
  assert.deepStrictEqual(legacyRuntime.records.orders[id], legacy, 'old data is not migrated');

  const conflictRuntime = makeBatchRuntime();
  const conflicting = await Promise.allSettled([
    shopEndpoint({}, context, conflictRuntime, 'orders.create', { ...input, requestKey: 'conflicting-batch', items: [{ skuId: 'sku-new', quantity: 2 }] }),
    shopEndpoint({}, context, conflictRuntime, 'orders.create', { ...input, requestKey: 'conflicting-batch', items: [{ skuId: 'sku-second', quantity: 1 }] }),
  ]);
  assert.strictEqual(conflicting.filter((result) => result.status === 'fulfilled').length, 1);
  assert.strictEqual(conflicting.find((result) => result.status === 'rejected').reason.code, 'IDEMPOTENCY_CONFLICT');
  assert.strictEqual(Object.keys(conflictRuntime.records.orders).length, 1, 'conflicting cart requests cannot bypass the full item hash');
}

async function testAddressGroupingPrecedesPaginationAndSeparatesRecipients() {
  const runtime = makeBatchRuntime();
  const context = { auth: { uid: 'admin-1' } };
  const address = runtime.records.addresses['address-1'];
  const makeOrder = (id, patch = {}) => ({ _id: id, orderNo: id, userId: 'user-1', status: 'paid', paymentStatus: 'paid', pendingRefundAmount: 0, pendingRefundQuantities: {}, items: [{ skuId: 'sku-new', quantity: 1 }], addressSnapshot: { ...address }, createdAt: '2026-04-01', ...patch });
  for (let index = 0; index < 120; index += 1) {
    const id = `group-${index}`;
    runtime.records.orders[id] = makeOrder(id, { createdAt: '2026-05-01', addressSnapshot: { ...address, _id: `address-copy-${index}` } });
  }
  for (const [id, patch] of [
    ['other-receiver', { addressSnapshot: { ...address, receiver: '另一个收货人' } }],
    ['other-phone', { addressSnapshot: { ...address, phone: '13900000000' } }],
    ['other-detail', { addressSnapshot: { ...address, detail: '另一个地址' } }],
    ['other-user', { userId: 'user-2' }],
    ['missing-1', { addressSnapshot: null }], ['missing-2', { addressSnapshot: null }],
  ]) runtime.records.orders[id] = makeOrder(id, patch);
  runtime.records.orders['group-0'].pendingRefundQuantities = { 'sku-new': 1 };
  runtime.records.orders['group-0'].pendingRefundAmount = 100;
  const first = await adminEndpoint({}, context, runtime, 'orders.list', { groupBy: 'address', pageSize: 1 });
  assert.strictEqual(first.total, 7);
  assert.strictEqual(first.totalOrders, 126);
  assert.strictEqual(first.items[0].orders.length, 120, 'grouping reads beyond the SDK page limit');
  assert.strictEqual(first.items[0].orderCount, 120);
  assert.strictEqual(first.items[0].address.receiver, address.receiver);
  assert.strictEqual(first.items[0].orders.find((order) => order._id === 'group-0').hasActiveAfterSale, true);
  const allGroups = await adminEndpoint({}, context, runtime, 'orders.list', { groupBy: 'address', pageSize: 100 });
  assert.strictEqual(allGroups.items.filter((group) => !group.canCombine).length, 2, 'missing addresses stay in independent groups');
  const search = await adminEndpoint({}, context, runtime, 'orders.list', { groupBy: 'address', orderNo: 'group-1' });
  assert.strictEqual(search.items.length, 1);
  assert.strictEqual(search.items[0].orders.length, 1);
  const flat = await adminEndpoint({}, context, runtime, 'orders.list', { orderNo: 'group-1' });
  assert.strictEqual(flat.items[0].addressSnapshot, undefined, 'flat list still omits raw address snapshots');
  runtime.records.orders['group-1'].status = 'received';
  runtime.records.orders['group-2'].status = 'completed';
  runtime.records.orders['group-2'].paymentStatus = 'partially_refunded';
  for (const useCommand of [true, false]) {
    if (!useCommand) delete runtime.db.command.in;
    const complete = await adminEndpoint({}, context, runtime, 'orders.list', { groupBy: 'address', status: 'completed' });
    assert.strictEqual(complete.items[0].orderCount, 2);
    const refunded = await adminEndpoint({}, context, runtime, 'orders.list', { groupBy: 'address', status: 'refunded' });
    assert.strictEqual(refunded.items[0].orderCount, 1);
  }
}

async function testBatchShippingHasNoBusinessCountLimit() {
  const runtime = makeBatchRuntime();
  const admin = { auth: { uid: 'admin-1' } };
  const original = await shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, 'orders.create', {
    requestKey: 'large-batch-ship', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const ids = [original._id];
  for (let index = 1; index < 120; index += 1) {
    const id = `large-batch-${index}`;
    runtime.records.orders[id] = { ...JSON.parse(JSON.stringify(original)), _id: id, orderNo: id };
    ids.push(id);
  }
  const group = (await adminEndpoint({}, admin, runtime, 'orders.list', { groupBy: 'address' })).items[0];
  assert.strictEqual(group.orderCount, 120);
  const input = { orderIds: ids, groupKey: group.key, trackingNo: 'LARGE-BATCH-001' };
  const result = await adminEndpoint({}, admin, runtime, 'orders.shipBatch', input);
  assert.strictEqual(result.total, 120);
  ids.forEach((id) => {
    assert.strictEqual(runtime.records.orders[id].status, 'shipped');
    assert.strictEqual(runtime.records.orders[id].tracking.trackingNo, input.trackingNo);
  });
  const repeated = await adminEndpoint({}, admin, runtime, 'orders.shipBatch', input);
  assert.strictEqual(repeated.total, 120);
  assert.strictEqual(repeated.shipmentBatchId, result.shipmentBatchId);
}

async function testBatchShippingRechecksAddressStateAndRefundsAtomically() {
  const runtime = makeBatchRuntime();
  const user = { auth: { uid: 'user-1' } };
  const admin = { auth: { uid: 'admin-1' } };
  const created = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'batch-ship', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 3 }, { skuId: 'sku-second', quantity: 2 }],
  });
  const group = (await adminEndpoint({}, admin, runtime, 'orders.list', { groupBy: 'address' })).items[0];
  const input = { orderIds: created.orderIds, groupKey: group.key, trackingNo: 'BATCH-001' };
  const ship = (data = input) => adminEndpoint({}, admin, runtime, 'orders.shipBatch', data);
  await assert.rejects(() => ship({ ...input, orderIds: [input.orderIds[0], input.orderIds[0]] }), appError('INVALID_ARGUMENT'));
  await assert.rejects(() => ship({ ...input, trackingNo: ' ' }), appError('INVALID_ARGUMENT'));
  await assert.rejects(() => ship({ ...input, orderIds: [] }), appError('INVALID_ARGUMENT'));
  await assert.rejects(() => ship({ ...input, orderIds: Array(51).fill(input.orderIds[0]) }), appError('INVALID_ARGUMENT'));
  runtime.records.adminMembers['inventory-1'] = { _id: 'inventory-1', status: 'active', roles: ['inventory'] };
  await assert.rejects(() => adminEndpoint({}, { auth: { uid: 'inventory-1' } }, runtime, 'orders.shipBatch', input), appError('FORBIDDEN'));

  const transaction = runtime.db.runTransaction;
  runtime.db.runTransaction = (worker) => {
    runtime.records.orders[created.orderIds[1]].addressSnapshot.detail = '发货确认前被修改';
    return transaction(worker);
  };
  await assert.rejects(() => ship(), appError('CONFLICT'));
  runtime.db.runTransaction = transaction;
  runtime.records.orders[created.orderIds[1]].addressSnapshot.detail = '测试地址';
  assert(created.orderIds.every((id) => runtime.records.orders[id].status === 'paid'));
  runtime.records.orders[created.orderIds[1]].status = 'refunded';
  await assert.rejects(() => ship(), appError('ORDER_STATE_INVALID'));
  runtime.records.orders[created.orderIds[1]].status = 'paid';
  const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created.orderIds[0], type: 20, reason: '退一件', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  await assert.rejects(() => ship(), appError('CONFLICT'));
  assert(created.orderIds.every((id) => runtime.records.orders[id].status === 'paid'), 'one active claim prevents partial shipment');
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved' });
  runtime.db.runTransaction = (worker) => transaction((tx) => worker({
    collection(name) {
      const ref = tx.collection(name);
      if (name !== 'orders') return ref;
      return { ...ref, doc(id) {
        const doc = ref.doc(id);
        return String(id) === created.orderIds[1] ? { ...doc, async update() { return { updated: 0 }; } } : doc;
      } };
    },
  }));
  await assert.rejects(() => ship(), appError('CONFLICT'));
  assert(created.orderIds.every((id) => runtime.records.orders[id].status === 'paid'), 'failed later writes roll back earlier shipment updates');
  runtime.db.runTransaction = transaction;
  const result = await ship();
  assert.strictEqual(result.total, 2);
  assert.strictEqual(result.items[0].shippedQuantities['sku-new'], 2);
  assert.strictEqual(result.items[1].shippedQuantities['sku-second'], 2);
  for (const order of result.items) {
    assert.strictEqual(order.status, 'shipped');
    assert.strictEqual(order.logistics.trackingNo, input.trackingNo);
    assert.strictEqual(order.shipmentBatchId, result.shipmentBatchId);
    assert.deepStrictEqual(order.shipmentOrderIds, created.orderIds);
  }
  const writes = runtime.writes.length;
  const retried = await ship({ ...input, orderIds: [...input.orderIds].reverse() });
  assert.strictEqual(retried.shipmentBatchId, result.shipmentBatchId);
  assert.strictEqual(runtime.writes.length, writes, 'lost batch shipment responses are safe to retry');
  await assert.rejects(() => ship({ ...input, trackingNo: 'DIFFERENT' }), appError('ORDER_STATE_INVALID'));
  await shopEndpoint({}, user, runtime, 'orders.confirmReceived', { orderId: created.orderIds[0] });
  assert.strictEqual(runtime.records.orders[created.orderIds[1]].status, 'shipped', 'receipt remains independent per order');
  const afterReceipt = await ship();
  assert.strictEqual(afterReceipt.items[0].status, 'received', 'late shipment retries do not reset an already-received order');
  assert.strictEqual(afterReceipt.items[1].status, 'shipped');
}

async function testPreShipmentPartialRefundLeavesAccurateShippedQuantity() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', roles: ['admin'], status: 'active' } };
  const user = { auth: { uid: 'user-1' } };
  const admin = { auth: { uid: 'admin-1' } };
  const created = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'refund-before-ship', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 3 }],
  });
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'orders.logistics.save', {
    orderId: created._id, trackingNo: 'MUST-NOT-SHIP',
  }), appError('ORDER_STATE_INVALID'));
  assert.strictEqual(runtime.records.orders[created._id].status, 'paid');
  const application = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created._id, type: 20, reason: '退其中一件', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: application._id, status: 'approved' });
  const shipped = await adminEndpoint({}, admin, runtime, 'orders.ship', {
    orderId: created._id, logistics: { companyName: '顺丰' }, trackingNo: 'SF-REMAIN',
  });
  assert.strictEqual(shipped.shippedQuantities['sku-new'], 2);
  const detail = await shopEndpoint({}, user, runtime, 'orders.detail', { orderId: created._id });
  assert.strictEqual(detail.items[0].refundedQuantity, 1);
  assert.strictEqual(detail.items[0].remainingQuantity, 2);
  assert.strictEqual(detail.items[0].fulfillableQuantity, 2);
}

async function testReturnRefundStateMachineAndPartialShipmentAccounting() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', uid: 'admin-1', roles: ['admin'], status: 'active' } };
  const user = { auth: { uid: 'user-1' } };
  const admin = { auth: { uid: 'admin-1' } };
  const created = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'partial-return', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 2 }],
  });
  const pending = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created._id, type: 20, reason: '先拦截发货', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'orders.ship', {
    orderId: created._id, logistics: { companyName: '顺丰' }, trackingNo: 'SF001',
  }), appError('CONFLICT'));
  const rejected = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: pending._id, status: 'rejected', reason: '请核实' });
  assert.strictEqual(rejected.status, 'rejected');
  assert.strictEqual(rejected.reviewReason, '请核实');

  const shipped = await adminEndpoint({}, admin, runtime, 'orders.ship', {
    orderId: created._id, logistics: { companyName: '顺丰' }, trackingNo: 'SF002',
  });
  assert.strictEqual(shipped.status, 'shipped');
  assert.strictEqual(shipped.tracking.trackingNo, 'SF002');
  assert.strictEqual(shipped.shippedQuantities['sku-new'], 2);
  const requestWithoutAddress = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created._id, type: 10, reason: '退货退款', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  assert.strictEqual(requestWithoutAddress.requestedType, 10);
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', {
    id: requestWithoutAddress._id, status: 'approved', type: 10,
  }), appError('RETURN_ADDRESS_REQUIRED'));
  await shopEndpoint({}, user, runtime, 'afterSales.withdraw', { afterSaleId: requestWithoutAddress._id });
  const address = { receiver: '退货收件人', phone: '13800000000', detail: '浙江省杭州市西湖区退货地址 1 号' };
  const savedSettings = await adminEndpoint({}, admin, runtime, 'settings.upsert', { key: 'global', value: { returnAddress: address } });
  assert.deepStrictEqual(savedSettings.value.returnAddress, address);
  const invalidAddress = { ...address, phone: 'bad' };
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'settings.upsert', { key: 'global', value: { returnAddress: invalidAddress } }), appError('INVALID_ARGUMENT'));

  const returned = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created._id, type: 20, reason: '质量问题', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  const approved = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: returned._id, status: 'approved', type: 10 });
  assert.strictEqual(approved.requestedType, 20);
  assert.strictEqual(approved.decidedType, 10);
  assert.strictEqual(runtime.records.afterSales[returned._id].type, 10);
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(approved.returnAddressSnapshot.detail, address.detail);
  const tracking = await shopEndpoint({}, user, runtime, 'afterSales.submitTracking', {
    afterSaleId: returned._id, logisticsCompanyName: '中通', trackingNo: 'ZT003',
  });
  assert.strictEqual(tracking.status, 'refunding');
  const refund = await adminEndpoint({}, admin, runtime, 'afterSales.confirmReturn', { afterSaleId: returned._id });
  assert.strictEqual(refund.status, 'refunded');
  assert.strictEqual(runtime.records.orders[created._id].paymentStatus, 'partially_refunded');
  assert.strictEqual(runtime.records.orders[created._id].refundAmount, 100);
  assert.strictEqual(runtime.records.orders[created._id].refundedQuantities['sku-new'], 1);
  const partialFilter = await adminEndpoint({}, admin, runtime, 'orders.list', { status: 'partial_refunded' });
  assert.strictEqual(partialFilter.total, 1);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);
  assert.strictEqual(runtime.records.skus['sku-new'].soldQuantity, 1);
  await adminEndpoint({}, admin, runtime, 'afterSales.confirmReturn', { afterSaleId: returned._id });
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);
  const partialDetail = await shopEndpoint({}, user, runtime, 'orders.detail', { orderId: created._id });
  assert.strictEqual(partialDetail.items[0].remainingQuantity, 1);

  const lastItem = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: created._id, type: 10, reason: '最后一件退货诉求', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  const finalRefund = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: lastItem._id, status: 'approved', type: 20 });
  assert.strictEqual(finalRefund.requestedType, 10);
  assert.strictEqual(finalRefund.decidedType, 20);
  assert.strictEqual(runtime.records.afterSales[lastItem._id].type, 20);
  assert.strictEqual(finalRefund.status, 'refunded');
  assert.strictEqual(runtime.records.orders[created._id].status, 'refunded');
  assert.strictEqual(runtime.records.orders[created._id].paymentStatus, 'refunded');
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9, 'a shipped item refunded without return does not replenish stock');
  const detail = await shopEndpoint({}, user, runtime, 'orders.detail', { orderId: created._id });
  assert.strictEqual(detail.items[0].remainingQuantity, 0);
  assert.strictEqual(detail.hasPendingComments, false);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'comments.create', { orderId: created._id, productId: 'product-1', content: '已全退商品' }), appError('FORBIDDEN'));
}

async function testAdminStatusRechecksAfterConcurrentRefund() {
  for (const next of ['received', 'completed']) {
    const runtime = makeRuntime();
    const user = { auth: { uid: 'user-1' } }, admin = { auth: { uid: 'admin-1' } };
    runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
    const order = await shopEndpoint({}, user, runtime, 'orders.create', {
      requestKey: `race-${next}`, addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
    });
    await adminEndpoint({}, admin, runtime, 'orders.ship', { orderId: order._id, trackingNo: 'SF001' });
    if (next === 'completed') {
      await adminEndpoint({}, admin, runtime, 'orders.updateStatus', { orderId: order._id, status: 'received' });
      assert.strictEqual(runtime.records.orders[order._id].fulfillmentStatus, 'received');
    }
    const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 20, reason: '退款' });
    const baseCollection = runtime.db.collection;
    let inject = true;
    runtime.db.collection = (name) => {
      const ref = baseCollection(name);
      if (name !== 'orders') return ref;
      return { ...ref, doc(id) {
        const doc = ref.doc(id);
        return { ...doc, async get() {
          const snapshot = await doc.get();
          if (inject) {
            inject = false;
            await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claim._id, status: 'approved', type: 20 });
          }
          return snapshot;
        } };
      } };
    };
    await assert.rejects(() => adminEndpoint({}, admin, runtime, 'orders.updateStatus', {
      orderId: order._id, status: next,
    }), appError('ORDER_STATE_INVALID'));
    assert.strictEqual(runtime.records.orders[order._id].status, 'refunded');
    assert.strictEqual(runtime.records.orders[order._id].paymentStatus, 'refunded');
  }
}

async function testMerchantRefundAmountsAndReservationRelease() {
  const runtime = makeRuntime();
  const user = { auth: { uid: 'user-1' } }, admin = { auth: { uid: 'admin-1' } };
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'merchant-amount', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 2 }],
  });
  const first = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: order._id, type: 20, receiptStatus: 2, reason: '取消一件', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  });
  for (const amount of [0, -1, 101, 0.5, '50']) {
    await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', {
      id: first._id, status: 'approved', type: 20, amount,
    }), appError('INVALID_ARGUMENT'));
    assert.strictEqual(runtime.records.afterSales[first._id].status, 'pending_review');
    assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 100);
  }
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', { id: first._id, status: 'approved', type: 20, amount: 50 }), appError('INVALID_ARGUMENT'));
  const refund = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: first._id, status: 'approved', type: 20, amount: 100 });
  assert.strictEqual(refund.amount, 100);
  assert.strictEqual(runtime.records.afterSales[first._id].amount, 100);
  assert.strictEqual(runtime.records.orders[order._id].refundAmount, 100);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 0);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundQuantities['sku-new'], 0);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: first._id, status: 'approved', type: 20, amount: 100 });
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);
  const shipped = await adminEndpoint({}, admin, runtime, 'orders.ship', { orderId: order._id, trackingNo: 'SF001' });
  assert.strictEqual(shipped.shippedQuantities['sku-new'], 1);
  runtime.records.settings = { global: { _id: 'global', value: { returnAddress: { receiver: '商家', phone: '13800000000', detail: '退货地址' } } } };
  const last = await shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 10, receiptStatus: 1, reason: '退货', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }] });
  const approved = await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: last._id, status: 'approved', type: 10, amount: 30 });
  assert.strictEqual(approved.amount, 30);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 100, 'keep original reservation until refund completes');
  await shopEndpoint({}, user, runtime, 'afterSales.submitTracking', { afterSaleId: last._id, trackingNo: 'ZT001' });
  await adminEndpoint({}, admin, runtime, 'afterSales.confirmReturn', { afterSaleId: last._id });
  await adminEndpoint({}, admin, runtime, 'afterSales.confirmReturn', { afterSaleId: last._id });
  const final = runtime.records.orders[order._id];
  assert.strictEqual(final.refundAmount, 130);
  assert.strictEqual(final.paymentStatus, 'partially_refunded');
  assert.strictEqual(final.status, 'refunded', 'all goods resolved closes the order even when merchant refunds less');
  assert.strictEqual(final.pendingRefundAmount, 0);
  assert.strictEqual(final.refundedQuantities['sku-new'], 2);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 20, reason: '重复申请' }), appError('ORDER_STATE_INVALID'));

  // Cancellation must refund the full claim and release inventory.
  const cancelled = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'discounted-cancel', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const cancelClaim = await shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: cancelled._id, type: 20, reason: '取消' });
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', { id: cancelClaim._id, status: 'approved', type: 20, amount: 1 }), appError('INVALID_ARGUMENT'));
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: cancelClaim._id, status: 'approved', type: 20, amount: 100 });
  assert.strictEqual(runtime.records.orders[cancelled._id].status, 'refunded');
  assert.strictEqual(runtime.records.orders[cancelled._id].inventoryReserved, false);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 10);

  // A discounted refund releases only its own reservation, not another SKU's claim.
  runtime.records.orders['order-1'] = receivedOrder([
    { productId: 'product-1', skuId: 'sku-new', quantity: 1, unitPrice: 100, amount: 100 },
    { productId: 'product-2', skuId: 'sku-other', quantity: 1, unitPrice: 200, amount: 200 },
  ]);
  const claimFor = (skuId) => shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: 'order-1', type: 20, reason: '退款', rightsItem: [{ skuId, rightsQuantity: 1 }],
  });
  const claimA = await claimFor('sku-new'), claimB = await claimFor('sku-other');
  assert.strictEqual(runtime.records.orders['order-1'].pendingRefundAmount, 300);
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claimA._id, status: 'approved', amount: 50 });
  assert.strictEqual(runtime.records.orders['order-1'].pendingRefundAmount, 200);
  assert.strictEqual(runtime.records.orders['order-1'].pendingRefundQuantities['sku-other'], 1);
  await assert.rejects(() => adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claimB._id, status: 'approved', amount: 201 }), appError('INVALID_ARGUMENT'));
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: claimB._id, status: 'rejected', reason: '不支持退款' });
  assert.strictEqual(runtime.records.orders['order-1'].pendingRefundAmount, 0);
  assert.strictEqual(runtime.records.orders['order-1'].refundAmount, 50);
}

async function testLegacyOrdersWithoutAfterSaleIndexCanApply() {
  const runtime = makeRuntime();
  const user = { auth: { uid: 'user-1' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'missing-after-sale-index', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  delete runtime.records.orders[order._id].afterSaleIds;
  const writeCount = runtime.writes.length;
  await shopEndpoint({}, user, runtime, 'afterSales.preview', { orderId: order._id });
  assert.strictEqual(runtime.writes.length, writeCount, 'preview must not migrate old orders');
  const claim = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: order._id, type: 20, receiptStatus: 2, reason: '取消订单',
  });
  assert.deepStrictEqual(runtime.records.orders[order._id].afterSaleIds, [claim._id]);
  assert.strictEqual(runtime.records.orders[order._id].pendingRefundAmount, 100);
  assert.strictEqual(runtime.records.orders[order._id].paymentAmount, 100);
  assert.strictEqual(runtime.records.skus['sku-new'].stockQuantity, 9);
  await shopEndpoint({}, user, runtime, 'afterSales.withdraw', { afterSaleId: claim._id });
  assert.strictEqual(runtime.records.afterSales[claim._id], undefined, 'withdrawn claims are deleted');
  assert.deepStrictEqual(runtime.records.orders[order._id].afterSaleIds, []);
  // A legacy index rebuild must not restore a deleted claim.
  delete runtime.records.orders[order._id].afterSaleIds;
  const second = await shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: order._id, type: 20, receiptStatus: 2, reason: '重新申请',
  });
  assert.deepStrictEqual(runtime.records.orders[order._id].afterSaleIds, [second._id]);
  await assert.rejects(() => shopEndpoint({}, user, runtime, 'afterSales.create', {
    orderId: order._id, type: 20, receiptStatus: 2, reason: '重复申请',
  }), appError('CONFLICT'));
}

async function testReceiptStatusAndClosedAfterSales() {
  const runtime = makeRuntime();
  const user = { auth: { uid: 'user-1' } }, admin = { auth: { uid: 'admin-1' } };
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  const order = await shopEndpoint({}, user, runtime, 'orders.create', {
    requestKey: 'receipt', addressId: 'address-1', items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const apply = (receiptStatus) => shopEndpoint({}, user, runtime, 'afterSales.create', { orderId: order._id, type: 20, reason: '退款', receiptStatus });
  await assert.rejects(() => apply(1), appError('INVALID_ARGUMENT'));
  const pending = await apply(2);
  assert.strictEqual(pending.receiptStatus, 2);
  await shopEndpoint({}, user, runtime, 'afterSales.withdraw', { afterSaleId: pending._id });
  await adminEndpoint({}, admin, runtime, 'orders.ship', { orderId: order._id, trackingNo: 'SF001' });
  const shipped = await apply(1);
  assert.strictEqual(shipped.receiptStatus, 1);
  await adminEndpoint({}, admin, runtime, 'afterSales.review', { id: shipped._id, status: 'rejected', reason: '超过售后期' });
  await shopEndpoint({}, user, runtime, 'orders.confirmReceived', { orderId: order._id });
  await assert.rejects(() => apply(2), appError('INVALID_ARGUMENT'));
  for (const invalid of [0, 3, '1']) await assert.rejects(() => apply(invalid), appError('INVALID_ARGUMENT'));
  const received = await apply(1);
  assert.strictEqual((await shopEndpoint({}, user, runtime, 'afterSales.detail', { afterSaleId: received._id })).receiptStatus, 1);
  runtime.records.afterSales.foreign = { ...pending, _id: 'foreign', userId: 'another-user', status: 'withdrawn' };
  for (const fallback of [false, true]) {
    if (fallback) delete runtime.db.command.in;
    const closed = await shopEndpoint({}, user, runtime, 'afterSales.list', { status: 'closed', page: 1, pageSize: 1 });
    assert.strictEqual(closed.total, 1);
    assert.strictEqual(closed.items.length, 1);
    const next = await shopEndpoint({}, user, runtime, 'afterSales.list', { status: 'closed', page: 2, pageSize: 1 });
    assert.deepStrictEqual(new Set([...closed.items, ...next.items].map((item) => item.status)), new Set(['rejected']));
    assert.strictEqual(closed.items[0].userId, 'user-1');
  }
}

async function testLegacyPaidOrdersDoNotGainSyntheticPaymentRecords() {
  const runtime = makeRuntime();
  runtime.records.orders['legacy-paid'] = { ...receivedOrder(), _id: 'legacy-paid', status: 'received', paymentStatus: 'paid', payment: null };
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'user-1' } }, runtime, 'afterSales.create', {
    orderId: 'legacy-paid', type: 20, reason: '仅退款', rightsItem: [{ skuId: 'sku-new', rightsQuantity: 1 }],
  }), appError('PAYMENT_NOT_CONFIGURED'));
  assert.strictEqual(runtime.records.orders['legacy-paid'].payment, null);
}

async function testDashboardCountsBeyondSdkQueryLimit() {
  const runtime = makeRuntime();
  runtime.records.adminMembers = { 'admin-1': { _id: 'admin-1', roles: ['admin'], status: 'active' } };
  for (const name of ['orders', 'comments', 'afterSales']) runtime.records[name] = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`item-${i}`, {
    _id: `item-${i}`, status: name === 'orders' ? 'paid' : 'pending_review',
  }]));
  const dashboard = await adminEndpoint({}, { auth: { uid: 'admin-1' } }, runtime, 'dashboard.summary', {});
  for (const field of ['orderCount', 'commentCount', 'afterSaleCount', 'pendingAfterSaleCount']) assert.strictEqual(dashboard.metrics[field], 120);
  assert.strictEqual(Object.hasOwn(dashboard.metrics, 'pendingOrderCount'), false);
}

const cases = [
  { name: 'missing runtime dependencies are not reported as missing business data', run: testMissingDependenciesAreNotMissingData },
  { name: 'only explicitly active administrators can access the backend', run: testOnlyActiveAdminsAreAllowed },
  { name: 'order prices, product snapshots and addresses are confirmed in the transaction', run: testOrderPricesAndSnapshotsAreConfirmedInTransaction },
  { name: 'historical pending-payment orders remain untouched and are not migrated on read', run: testHistoricalPendingPaymentOrdersRemainUntouched },
  { name: 'comments are atomic, public fields are restricted, and owners see pending reviews', run: testCommentsAreAtomicPrivateAndQueryableByOwner },
  { name: 'received orders and pending comments use consistent tabs and pagination', run: testReceivedOrdersAndPendingCommentPagination },
  { name: 'image filtering precedes comment pagination and total counting', run: testImageFilterPrecedesCommentPagination },
  { name: 'after-sales validate SKU, quantity, amount and serialize concurrent claims', run: testAfterSalesValidateSkuQuantityAmountAndConcurrentClaims },
  { name: 'new orders simulate payment and a full pre-shipment refund restores inventory exactly once', run: testSimulatedPaymentAddressChangeAndFullRefundRestoreInventory },
  { name: 'cart checkout removes only selected items and remains idempotent after retries', run: testCartCheckoutRetryAfterAtomicRemovalIsIdempotent },
  { name: 'multi-product checkout creates one order per SKU atomically and preserves retries and independent refunds', run: testMultiProductCheckoutIsAtomicAndIdempotent },
  { name: 'split checkout rolls back stock and cart changes without resolving old hashed order IDs', run: testSplitCheckoutRollbackAndLegacyCompatibility },
  { name: 'address groups paginate after grouping and isolate users and recipients', run: testAddressGroupingPrecedesPaginationAndSeparatesRecipients },
  { name: 'batch shipping supports more than 50 orders and safe retries without a business count limit', run: testBatchShippingHasNoBusinessCountLimit },
  { name: 'batch shipping rechecks address, status and refund quantities atomically and supports safe retries', run: testBatchShippingRechecksAddressStateAndRefundsAtomically },
  { name: 'pre-shipment partial refunds leave the correct quantity for shipment and review', run: testPreShipmentPartialRefundLeavesAccurateShippedQuantity },
  { name: 'return refund, partial shipment and fully refunded comment eligibility follow the state machine', run: testReturnRefundStateMachineAndPartialShipmentAccounting },
  { name: 'admin status transitions recheck concurrent refunds atomically', run: testAdminStatusRechecksAfterConcurrentRefund },
  { name: 'merchant refund amounts release reservations and close resolved orders without duplicate inventory', run: testMerchantRefundAmountsAndReservationRelease },
  { name: 'legacy paid orders without an after-sale index can apply without resetting financial aggregates', run: testLegacyOrdersWithoutAfterSaleIndexCanApply },
  { name: 'receipt status is persisted and closed after-sales include rejected and withdrawn before pagination', run: testReceiptStatusAndClosedAfterSales },
  { name: 'legacy paid orders do not receive synthetic payment records for refunds', run: testLegacyPaidOrdersDoNotGainSyntheticPaymentRecords },
  { name: 'dashboard counts are complete beyond the SDK default query limit', run: testDashboardCountsBeyondSdkQueryLimit },
  { name: 'image uploads preserve bytes with unrestricted prepared admin and user output', run: testImageUploads },
  { name: 'product search combines segmented terms across names, parent/child categories and configured specs before pagination', run: testProductSearchAcrossNamesCategoriesAndSpecs },
  { name: 'product lists sort by title, newest configured SKU timestamp and ascending/descending price before pagination', run: testProductListSortsByNameSkuAndPrice },
  { name: 'timestamp SKU IDs stay unique across variants and saves without overwriting existing SKUs', run: testSkuTimestampIdsAvoidCollisions },
  { name: 'simple product variants set cover price and SKUs', run: testSimpleProductVariantsSetCoverPriceAndSkus },
  { name: 'product save manages SKU inventory and images without SKU status', run: testProductSaveManagesSkuInventoryAndImagesWithoutSkuStatus },
  { name: 'SKU inventory is set separately and stale updates conflict', run: testSkuInventoryCanBeSetSeparatelyWithoutProductSaveResettingIt },
  { name: 'product SKU list and save read every variant', run: testProductSkuListAndSaveReadEveryVariant },
  {
    name: 'event.userInfo is not trusted as identity',
    run: testTrustedIdentityDoesNotComeFromEventUserInfo,
  },
  { name: 'pagination accepts page and ignores old pageNum', run: testPageNumIsAcceptedAsPage },
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
  { name: 'order preview accepts no address while creation still requires one', run: testOrderPreviewAllowsMissingAddressWithoutCreatingAnOrder },
  { name: 'order creation rechecks product status inside transaction', run: testOrderCreationRechecksProductStatus },
  { name: 'paid orders reject direct cancellation and refund only through reviewed after-sales', run: testPaidOrdersCannotBeCancelled },
  { name: 'dashboard product count is not limited to the first page', run: testDashboardProductCountUsesCountQuery },
  { name: 'home configuration limits and current-only response', run: testHomeConfigLimitsAndLegacyResponse },
  { name: 'deleting a product clears home links while preserving slots', run: testDeletingProductClearsHomeLinksWithoutRemovingSlots },
  { name: 'home cleanup rejects old product aliases and preserves current document IDs', run: testHomeCleanupPreservesActiveLegacyProductLinks },
  { name: 'inactive products are pinned before pagination', run: testInactiveProductsArePinnedBeforePagination },
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

module.exports = { run, makeRuntime };
