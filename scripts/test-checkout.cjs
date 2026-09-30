const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { defaultLocalStorageDirectory, prepareLocalStorage } = require('./local-backend-storage.cjs');

const root = path.resolve(__dirname, '..');
const calls = [];
const toasts = [];
const navigation = [];
let pageDefinition;
const address = { _id: 'address-1', receiver: '测试收货人', phone: '13800000000', detail: '测试地址' };
const mocks = {
  'tdesign-miniprogram/toast/index': (options) => toasts.push(options),
  [path.join(root, 'utils/api.ts')]: {
    getApiErrorMessage: (error, fallback) => error.message || fallback,
    getTempFileUrl: async (fileID) => `https://images.example/${fileID.split('://')[1]}`,
    request: async (action, payload) => {
      calls.push({ action, payload });
      if (action === 'cart.get') {
        return { items: [{
          skuId: 'sku-1', spuId: 'product-1', title: '测试商品', quantity: 2, stockQuantity: 20,
          primaryImage: 'local://products/cover.webp', skuSnapshot: {}, isSelected: true,
        }] };
      }
      assert.equal(action, 'orders.preview');
      return {
        addressSnapshot: payload.addressId ? address : null,
        totalAmount: 200,
        items: [{
          skuId: 'sku-1', quantity: 2, unitPrice: 100,
          productSnapshot: { _id: 'product-1', title: '测试商品', primaryImage: 'local://products/cover.webp' },
          skuSnapshot: { specInfo: [{ specValue: '标准' }] },
        }],
      };
    },
  },
};
const cache = new Map();

function load(file) {
  const filename = path.resolve(root, file);
  if (mocks[filename]) return mocks[filename];
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (mocks[name]) return mocks[name];
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Page: (definition) => { pageDefinition = definition; },
    wx: {
      navigateBack: () => navigation.push('back'),
      navigateTo: ({ url }) => navigation.push(url),
    },
    setTimeout: (callback) => callback(),
  }, { filename });
  return exports;
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-shop-storage-test-'));
  try {
    const workspace = path.join(temporaryRoot, 'project');
    const storage = path.join(temporaryRoot, 'runtime');
    const legacyFiles = path.join(workspace, 'data', '.local-files');
    fs.mkdirSync(legacyFiles, { recursive: true });
    const legacyData = path.join(workspace, 'data', '.local-backend.json');
    fs.writeFileSync(legacyData, '{"version":1}');
    fs.writeFileSync(path.join(legacyFiles, 'cover.webp'), 'image');
    const migrated = prepareLocalStorage(workspace, storage);
    assert.equal(migrated.filesRoot, path.join(storage, '.local-files'));
    assert.equal(fs.readFileSync(migrated.dataFile, 'utf8'), '{"version":1}');
    assert.equal(fs.readFileSync(path.join(migrated.filesRoot, 'cover.webp'), 'utf8'), 'image');
    fs.writeFileSync(migrated.dataFile, '{"version":2}');
    const previousFiles = path.join(workspace, '.local-files');
    fs.mkdirSync(previousFiles, { recursive: true });
    fs.writeFileSync(path.join(previousFiles, 'previous.webp'), 'previous image');
    fs.writeFileSync(path.join(previousFiles, 'cover.webp'), 'old image');
    prepareLocalStorage(workspace, storage);
    assert.equal(fs.readFileSync(path.join(migrated.filesRoot, 'previous.webp'), 'utf8'), 'previous image');
    assert.equal(fs.readFileSync(path.join(migrated.filesRoot, 'cover.webp'), 'utf8'), 'image');
    assert.equal(fs.readFileSync(migrated.dataFile, 'utf8'), '{"version":2}');
    assert.equal(fs.readFileSync(legacyData, 'utf8'), '{"version":1}');
    assert.ok(path.relative(workspace, defaultLocalStorageDirectory(workspace)).startsWith('..'));
    assert.equal(defaultLocalStorageDirectory(workspace), defaultLocalStorageDirectory(path.join(workspace, '.')));
    const projectData = path.join(workspace, '.local-data', '.local-backend.json');
    fs.mkdirSync(path.dirname(projectData), { recursive: true });
    fs.writeFileSync(projectData, '{"version":3}');
    const currentStorage = path.join(temporaryRoot, 'current-runtime');
    const projectStorage = prepareLocalStorage(workspace, currentStorage);
    assert.equal(projectStorage.dataFile, path.join(currentStorage, '.local-backend.json'));
    assert.equal(fs.readFileSync(projectStorage.dataFile, 'utf8'), '{"version":3}');
    assert.equal(fs.readFileSync(path.join(projectStorage.filesRoot, 'cover.webp'), 'utf8'), 'old image');
    const sourceTimestamp = fs.statSync(projectData).mtimeMs;
    fs.writeFileSync(projectStorage.dataFile, '{"version":4}');
    prepareLocalStorage(workspace, currentStorage);
    assert.equal(fs.readFileSync(projectStorage.dataFile, 'utf8'), '{"version":4}');
    assert.equal(fs.readFileSync(projectData, 'utf8'), '{"version":3}');
    assert.equal(fs.statSync(projectData).mtimeMs, sourceTimestamp);
    console.log('PASS runtime writes stay outside the project and migration preserves existing data');
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    assert.ok(resolvedTemporaryRoot.startsWith(`${path.resolve(os.tmpdir())}${path.sep}wc-shop-storage-test-`));
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  }
  const service = load('services/order/orderConfirm.ts');
  const goods = { skuId: 'sku-1', storeId: 'default', quantity: 2, price: 9999 };
  service.setPendingGoodsRequestList([goods]);
  const preview = await service.fetchSettleDetail({ goodsRequestList: [goods] });
  assert.equal(calls[0].payload.addressId, '');
  assert.equal(calls[0].payload.items[0].quantity, 2);
  assert.equal(calls[0].payload.items[0].price, undefined);
  assert.equal(preview.data.userAddress, null);
  assert.equal(preview.data.totalPayAmount, 200);
  assert.equal(preview.data.storeGoodsList[0].skuDetailVos[0].image, 'https://images.example/products/cover.webp');
  const withAddress = await service.fetchSettleDetail({ goodsRequestList: [goods], addressId: 'address-1' });
  assert.equal(withAddress.data.userAddress.addressId, 'address-1');
  assert.equal(withAddress.data.userAddress.name, '测试收货人');
  assert.equal(withAddress.data.userAddress.detailAddress, '测试地址');
  const requestsBeforeCreate = calls.length;
  await assert.rejects(service.createPendingOrder({ goodsRequestList: [goods], requestKey: 'test' }),
    (error) => error.code === 'ADDRESS_REQUIRED');
  assert.equal(calls.length, requestsBeforeCreate);

  mocks[path.join(root, 'services/address/fetchAddress.ts')] = {
    fetchDeliveryAddress: async () => null,
  };
  load('pages/order/order-confirm/index.ts');
  const page = {
    ...pageDefinition,
    data: structuredClone(pageDefinition.data),
    setData(patch) { Object.assign(this.data, patch); },
  };
  page.onLoad({ type: 'direct' });
  await flush();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.userAddress, null);
  assert.equal(page.data.orderCardList[0].goodsList[0].title, '测试商品');
  assert.equal(page.data.orderCardList[0].goodsList[0].num, 2);
  assert.equal(page.data.settleDetailData.totalPayAmount, 200);
  assert.equal(navigation.length, 0, 'no address must not navigate away from confirmation');
  page.submitOrder();
  assert.equal(toasts.at(-1).message, '请添加收货地址');
  assert.equal(page.payLock, false);
  assert.equal(navigation.length, 0);

  page.handleOptionsParams({ userAddressReq: withAddress.data.userAddress });
  await flush();
  assert.equal(page.data.userAddress.detailAddress, '测试地址');
  assert.equal(page.goodsRequestList[0].skuId, 'sku-1');
  assert.equal(calls.at(-1).payload.addressId, 'address-1');
  console.log('PASS checkout previews without an address, preserves goods and server pricing, and requires an address before creating an order');

  const cartService = load('services/cart/cart.ts');
  const cart = await cartService.fetchCartGroupData();
  const cartGoods = cart.data.storeGoods[0].promotionGoodsList[0].goodsPromotionList[0];
  assert.equal(cartGoods.thumb, 'https://images.example/products/cover.webp');
  assert.equal(cartGoods.primaryImage, cartGoods.thumb);
  assert.equal(cartGoods.stockQuantity, 20);
  assert.equal(cartGoods.quantity, 2);
  console.log('PASS cart resolves stored image references before rendering');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
