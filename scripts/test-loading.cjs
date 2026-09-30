const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let page, component, respond;
let resolves = 0;
const deferred = new Map();
const api = {
  getApiErrorMessage: (error) => error.message,
  getTempFileUrl: async (id) => {
    resolves++;
    if (deferred.has(id)) return deferred.get(id).promise;
    if (id.includes('broken')) throw new Error('missing');
    return `https://example.test/${id.split('://')[1]}`;
  },
  request: (action, payload) => respond(action, payload),
};
function load(file) {
  const filename = path.resolve(root, file);
  if (filename === path.join(root, 'utils/api.ts')) return api;
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports,
    require(name) {
      if (name === 'tdesign-miniprogram/toast/index') return () => {};
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    },
    Page: (value) => { page = value; }, Component: (value) => { component = value; },
    wx: { getWindowInfo: () => ({ screenWidth: 375, pixelRatio: 2 }), stopPullDownRefresh() {}, showToast() {} },
  }, { filename });
  return exports;
}
const snapshot = {
  quantity: 2, unitPrice: 100, productSnapshot: { _id: 'p1', title: '商品', primaryImage: 'local://cover.webp' },
  skuSnapshot: { _id: 's1', specInfo: [{ specValue: '标准' }] },
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
function instance(definition) {
  return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
}
async function run() {
  const images = load('utils/images.ts');
  const urls = await Promise.all([images.resolveImage('local://cover.webp'), images.resolveImage('local://cover.webp')]);
  assert.equal(resolves, 1); assert.equal(urls[0], urls[1]);
  assert.equal(await images.resolveImage('cloud://broken'), '');
  assert.equal(await images.resolveImage('/assets/user-avatar.jpg'), '/assets/user-avatar.jpg');
  respond = async () => ({ items: [{ images: ['cloud://comment.webp'], avatarUrl: 'local://avatar.webp' }] });
  const comments = await load('services/comments/fetchComments.ts').fetchComments();
  const resource = comments.pageList[0].commentResources[0];
  assert.equal(resource.image, 'https://example.test/comment.webp');
  assert.equal(resource.fileID, 'cloud://comment.webp');
  const payload = load('services/comments/api.ts').normalizeCommentPayload({ commentResources: [resource] });
  assert.equal(payload.images[0], 'cloud://comment.webp');
  respond = async (action) => action === 'orders.list' ? { orders: [{ items: [snapshot] }] } : { items: [snapshot] };
  const list = await load('services/order/orderList.ts').fetchOrders();
  const detail = await load('services/order/orderDetail.ts').fetchOrderDetail({ orderNo: 'o1' });
  assert.equal(list.data.orders[0].orderItemVOs[0].goodsPictureUrl, 'https://example.test/cover.webp');
  assert.equal(detail.data.orderItemVOs[0].goodsPictureUrl, 'https://example.test/cover.webp');
  respond = async () => ({ status: 'received', hasPendingComments: false, items: [snapshot],
    addressSnapshot: { receiver: '收货人', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试街道' } });
  const received = await load('services/order/orderDetail.ts').fetchOrderDetail({ orderNo: 'o1' });
  assert.equal(received.data.orderStatus, 50);
  assert.equal(received.data.logisticsVO.receiverProvince, '广东省');
  assert.equal(received.data.logisticsVO.receiverAddress, '测试街道');
  assert.equal(received.data.buttonVOs[0].type, 10);
  load('pages/goods/comments/index.ts');
  const commentsPage = instance(page);
  commentsPage.data.spuId = 'p1';
  const firstQuery = commentsPage.generalQueryData(true);
  const nextQuery = commentsPage.generalQueryData(false);
  assert.equal(firstQuery.pageSize, nextQuery.pageSize);
  assert.equal(firstQuery.pageNum, 1);
  assert.equal(nextQuery.pageNum, 2);
  respond = async (action) => action === 'afterSales.list'
    ? { items: [{ items: [snapshot] }] } : { items: [snapshot], images: ['cloud://proof.webp'] };
  const rights = await load('pages/order/after-service-detail/api.ts').getRightsDetail({ rightsNo: 'r1' });
  assert.equal(rights.data[0].rightsItem[0].goodsName, '商品');
  assert.equal(rights.data[0].rightsItem[0].goodsPictureUrl, 'https://example.test/cover.webp');
  assert.equal(rights.data[0].rights.rightsImageUrls[0], 'https://example.test/proof.webp');
  const rightsList = await load('pages/order/after-service-list/api.ts').getRightsList();
  assert.equal(rightsList.data.dataList[0].rightsItem[0].goodsPictureUrl, 'https://example.test/cover.webp');
  respond = async () => ({ items: [snapshot, { ...snapshot, skuSnapshot: { _id: 's2' } }] });
  const preview = await load('pages/order/apply-service/api.ts').fetchRightsPreview({ orderNo: 'o1', skuId: 's1' });
  assert.equal(preview.data.goodsList.length, 1);
  assert.equal(preview.data.goodsList[0].skuId, 's1');
  assert.equal(preview.data.goodsList[0].goodsInfo.skuImage, 'https://example.test/cover.webp');
  assert.equal(preview.data.refundableAmount, 200);
  let submittedClaim;
  respond = async (action, payload) => { assert.equal(action, 'afterSales.create'); submittedClaim = payload; return {}; };
  await load('pages/order/apply-service/api.ts').dispatchApplyService({
    rights: { orderNo: 'o1', rightsType: 20, refundRequestAmount: 100, rightsReasonDesc: '质量问题' },
    rightsItem: [{ skuId: 's1', productId: 'p1', rightsQuantity: 1 }],
  });
  assert.equal(submittedClaim.refundRequestAmount, 100);
  assert.equal(submittedClaim.rightsItem[0].rightsQuantity, 1);
  assert.equal(snapshot.productSnapshot.primaryImage, 'local://cover.webp');
  const goods = load('services/good/resolveImages.ts');
  const home = await goods.resolveHomeContentImages({ swiperImages: ['local://banner.webp'], items: [{ type: 'banner', cover: 'cloud://banner.webp' }] });
  assert.equal(home.swiperImages[0], 'https://example.test/banner.webp');
  assert.equal(home.items[0].image, 'https://example.test/banner.webp');
  const categories = await goods.resolveCategoryListImages([{ image: 'cloud://parent.webp', children: [{ image: 'local://child.webp' }] }]);
  assert.equal(categories[0].image, 'https://example.test/parent.webp');
  const wxs = { module: { exports: {} }, getRegExp: (source, flags) => new RegExp(source, flags) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/webp-image/utils.wxs'), 'utf8'), wxs);
  const transform = wxs.module.exports;
  const cosThumb = load('utils/util.ts').cosThumb;
  for (const url of ['/assets/user-avatar.jpg', 'data:image/png;base64,abc', 'wxfile://tmp.png', 'http://localhost:8787/files?fileID=local%3A', 'http://third.test/a.jpg', 'https://bucket.cos.ap-guangzhou.myqcloud.com/a.jpg?sign=abc']) {
    assert.equal(transform.imageMogr(url, { width: 50 }), url);
    assert.equal(cosThumb(url, 50), url);
    assert.equal(transform.getSrc({ src: url, thumbWidth: 0, thumbHeight: 0 }), url);
  }
  const gif = transform.imageMogr('https://bucket.cos.ap-guangzhou.myqcloud.com/a.multi.GIF', { width: 50, format: 'webp' });
  assert.ok(gif.includes('/cgif/1')); assert.ok(!gif.includes('/format/webp'));
  load('components/webp-image/index.ts');
  const image = instance(component);
  let finish;
  deferred.set('cloud://slow.webp', { promise: new Promise((resolve) => { finish = resolve; }) });
  component.observers.src.call(image, 'cloud://slow.webp');
  await flush();
  component.observers.src.call(image, '/assets/new.jpg');
  await flush(); finish('https://example.test/old.webp'); await flush();
  assert.equal(image.data.displaySrc, '/assets/new.jpg');
  load('pages/goods/comments/components/comments-card/components/images-videos/index.ts');
  const card = instance(component);
  let oldFinish;
  deferred.set('cloud://old-comment.webp', { promise: new Promise((resolve) => { oldFinish = resolve; }) });
  component.observers.resources.call(card, [{ type: 'image', fileID: 'cloud://old-comment.webp' }]); await flush();
  component.observers.resources.call(card, []); await flush(); oldFinish('https://example.test/old.webp'); await flush();
  assert.equal(card.data.imageResources.length, 0);
  respond = async () => { throw new Error('网络不可用'); };
  await assert.rejects(load('services/good/fetchHomeContent.ts').fetchHomeContent(), /网络不可用/);
  load('pages/home/home.ts'); const homepage = instance(page);
  homepage.data.swiperSlides = ['existing'];
  await homepage.loadHomePage();
  assert.equal(homepage.data.pageLoading, false); assert.equal(homepage.data.loadError, '网络不可用');
  assert.equal(homepage.data.swiperSlides[0], 'existing');
  respond = async () => ({ config: { banners: [], promos: [], sections: [] } });
  await homepage.loadHomePage(); assert.equal(homepage.data.loadError, '');
  respond = async () => { throw new Error('订单不存在'); };
  load('pages/order/order-detail/index.ts');
  const orderpage = instance(page); orderpage.orderNo = 'missing'; orderpage.getStoreDetail = () => {};
  await orderpage.init();
  assert.equal(orderpage.data.pageLoading, false); assert.equal(orderpage.data.loadError, '订单不存在');
  respond = async () => ({ items: [snapshot] });
  await orderpage.init(); assert.equal(orderpage.data.loadError, '');
  assert.equal(orderpage.data._order.goodsList[0].thumb, 'https://example.test/cover.webp');
  console.log('PASS image URLs, snapshot adapters, comment IDs, async races, home failure and retry');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
