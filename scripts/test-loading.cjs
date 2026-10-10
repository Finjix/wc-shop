const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let page, component, respond;
let resolves = 0;
const imagePreviews = [];
const deferred = new Map();
const tabNavigations = [];
const pageNavigations = [];
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
      if (name === 'tdesign-miniprogram/toast/index') return { default: () => {} };
      if (name.startsWith('.')) return load(`${path.resolve(path.dirname(filename), name)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    },
    Page: (value) => { page = value; }, Component: (value) => { component = value; },
    wx: { getWindowInfo: () => ({ screenWidth: 375, pixelRatio: 2 }), stopPullDownRefresh() {}, showToast() {}, navigateTo(options) { pageNavigations.push(options.url); }, switchTab(options) { tabNavigations.push(options.url); }, previewImage(options) { imagePreviews.push(options); } },
  }, { filename });
  return exports;
}
const snapshot = {
  productId: 'p1', skuId: 's1', availableRefundQuantity: 2, fulfillableQuantity: 2, amount: 200,
  quantity: 2, unitPrice: 100, productSnapshot: { _id: 'p1', title: '商品', primaryImage: 'local://cover.webp' },
  skuSnapshot: { _id: 's1', specInfo: [{ specValue: '标准' }] },
};
const currentOrder = { _id: 'o1', orderNo: 'o1', status: 'paid', commentedProductIds: [], pendingRefundAmount: 0, activeAfterSaleCount: 0, addressSnapshot: { receiver: '收货人', phone: '13800000000', detail: '测试街道' } };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function instance(definition) {
  return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
}
async function run() {
  const applyServiceMarkup = fs.readFileSync(path.join(root, 'pages/order/apply-service/index.wxml'), 'utf8');
  const applyServiceDefinition = fs.readFileSync(path.join(root, 'pages/order/apply-service/index.ts'), 'utf8');
  assert.doesNotMatch(applyServiceMarkup, /wr-order-goods-card|slot="footer"/);
  assert.match(applyServiceMarkup, /apply-goods-summary__image/);
  assert.match(applyServiceMarkup, /apply-goods-summary__price/);
  assert.match(applyServiceMarkup, /<t-stepper[\s\S]*?max="\{\{maxApplyNum\}\}"/);
  assert.match(applyServiceDefinition, /paidAmountText:\s*priceFormat\(goods\.paidAmountEach,\s*2\)/);
  console.log('PASS SKU after-sales form uses native product summary and preserves its quantity stepper');
  const orderButtonBarMarkup = fs.readFileSync(path.join(root, 'pages/order/components/order-button-bar/index.wxml'), 'utf8');
  const afterServiceMarkupForConfirm = fs.readFileSync(path.join(root, 'pages/order/after-service-detail/index.wxml'), 'utf8');
  const themeStyles = fs.readFileSync(path.join(root, 'style/theme.wxss'), 'utf8');
  assert.match(orderButtonBarMarkup, /t-dialog[^>]*t-class-confirm="commerce-dialog-confirm"/);
  assert.match(afterServiceMarkupForConfirm, /t-dialog id="t-dialog" t-class-confirm="commerce-dialog-confirm"/);
  assert.match(themeStyles, /\.commerce-dialog-confirm\s*\{[^}]*--td-button-primary-text-color:\s*#695941;/);
  const orderDetailMarkup = fs.readFileSync(path.join(root, 'pages/order/order-detail/index.wxml'), 'utf8');
  assert.doesNotMatch(orderDetailMarkup, /catchtap="onApplyGoodsRefund"/);
  console.log('PASS order and after-sales confirmation dialogs use a visible shared primary-text style');
  const homeStyles = fs.readFileSync(path.join(root, 'pages/home/home.wxss'), 'utf8');
  const homeMarkup = fs.readFileSync(path.join(root, 'pages/home/home.wxml'), 'utf8');
  assert.match(homeStyles, /\.home-scroll\s*\{[^}]*height:\s*calc\(100vh\s*-\s*100rpx\s*-\s*env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(homeMarkup, /<scroll-view[^>]*\benhanced\b/);
  console.log('PASS home scroll hit area stops above the custom tab bar and avoids enhanced native hit testing');
  const afterServiceMarkup = fs.readFileSync(path.join(root, 'pages/order/after-service-detail/index.wxml'), 'utf8');
  const afterServiceStyles = fs.readFileSync(path.join(root, 'pages/order/after-service-detail/index.wxss'), 'utf8');
  assert.doesNotMatch(afterServiceMarkup, /该订单使用模拟支付|class="service-section__pay pay-result"/);
  assert.match(afterServiceMarkup, /<t-icon wx:if="\{\{!service\.isRefunded\}\}"/);
  assert.match(afterServiceMarkup, /class="refund-summary" wx:if="\{\{service\.isRefunded\}\}"[\s\S]*?<text>退款金额<\/text>[\s\S]*?<wr-price price="\{\{service\.refundRequestAmount\}\}"/);
  assert.match(afterServiceStyles, /\.refund-summary__price-part\s*\{[^}]*font-size:\s*26rpx;/);
  assert.doesNotMatch(afterServiceMarkup, /微信退款后|微信支付账单|银行处理时间/);
  assert.match(afterServiceMarkup, /title="订单编号"/);
  assert.match(afterServiceStyles, /\.service-id-row__value[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  const rightsContract = load('pages/order/after-service-detail/contract.ts');
  assert.equal(rightsContract.normalizeOrderItem({ ...snapshot, quantity: 1, rightsQuantity: 1, amount: 100 }).itemRefundAmount, 100);
  assert.equal(rightsContract.normalizeServiceStatus('withdrawn'), 170);
  load('custom-tab-bar/index.ts');
  const tabBarDefinition = component;
  const tabBar = {
    ...tabBarDefinition.methods,
    data: { ...tabBarDefinition.data },
    setData(value) { Object.assign(this.data, value); },
  };
  [
    ['/pages/home/home', '首页'],
    ['/pages/category/index', '商品'],
    ['/pages/cart/index', '购物车'],
    ['/pages/usercenter/index', '我的'],
  ].forEach(([url], index) => tabBar.onItemTap({ currentTarget: { dataset: { index: String(index) } } }));
  assert.deepEqual(tabNavigations, ['/pages/home/home', '/pages/category/index', '/pages/cart/index', '/pages/usercenter/index']);
  assert.equal(tabBar.data.active, 3);
  console.log('PASS native custom-tab callback navigates all four tabs and updates the active state');
  const images = load('utils/images.ts');
  const urls = await Promise.all([images.resolveImage('local://cover.webp'), images.resolveImage('local://cover.webp')]);
  assert.equal(resolves, 1); assert.equal(urls[0], urls[1]);
  assert.equal(await images.resolveImage('cloud://broken'), '');
  assert.equal(await images.resolveImage('/assets/user-avatar.jpg'), '/assets/user-avatar.jpg');
  respond = async () => ({ items: [{ images: ['cloud://comment.webp'], avatarUrl: 'local://avatar.webp' }] });
  const comments = await load('pages/goods/services/comments/fetchComments.ts').fetchComments();
  assert.equal(comments.pageList[0].userHeadUrl, '/assets/user-avatar.jpg');
  const resource = comments.pageList[0].commentResources[0];
  assert.equal(resource.image, 'https://example.test/comment.webp');
  assert.equal(resource.fileID, 'cloud://comment.webp');
  const payload = load('pages/goods/services/comments/api.ts').normalizeCommentPayload({ commentResources: [resource.fileID] });
  assert.equal(payload.images[0], 'cloud://comment.webp');
  respond = async (action) => action === 'orders.list' ? { items: [{ ...currentOrder, items: [snapshot] }] } : { ...currentOrder, items: [snapshot] };
  const list = await load('pages/order/services/orderList.ts').fetchOrders({ parameter: { page: 1 } });
  const detail = await load('pages/order/services/orderDetail.ts').fetchOrderDetail({ orderNo: 'o1' });
  assert.equal(list.data.orders[0].orderItemVOs[0].goodsPictureUrl, 'https://example.test/cover.webp');
  assert.equal(detail.data.orderItemVOs[0].goodsPictureUrl, 'https://example.test/cover.webp');
  respond = async (action) => action === 'orders.list' ? {
    items: [{ ...currentOrder, status: 'paid', pendingRefundAmount: 100, activeAfterSaleStatus: 'pending_review', items: [{
      ...snapshot, quantity: 3, refundedQuantity: 1, remainingQuantity: 2, fulfillableQuantity: 2,
    }] }],
  } : {};
  const activeRefundOrder = await load('pages/order/services/orderList.ts').fetchOrders({ parameter: { page: 1 } });
  const activeRefund = activeRefundOrder.data.orders[0];
  assert.equal(activeRefund.orderStatus, 10);
  assert.equal(activeRefund.orderStatusName, '退款审核中');
  assert.equal(activeRefund.orderItemVOs[0].fulfillableQuantity, 2);
  assert.ok(!activeRefund.buttonVOs.some((button) => Number(button.type) === 4));
  console.log('PASS simulated-paid order and pending refund normalize with remaining quantity');
  const orderListApi = load('pages/order/services/orderList.ts');
  const unsupportedLegacyOrder = orderListApi.normalizeOrder({
    ...currentOrder, status: 5,
    orderStatusName: 'legacy-state',
    items: [snapshot],
    buttonVOs: [{ type: 2, name: 'legacy-action' }],
  });
  assert.equal(unsupportedLegacyOrder.orderStatus, 0);
  assert.equal(unsupportedLegacyOrder.orderStatusName, '订单状态不可用');
  assert.equal(unsupportedLegacyOrder.buttonVOs.length, 0);
  const processingOrder = orderListApi.normalizeOrder({
    ...currentOrder, status: 'paid', activeAfterSaleStatus: 'processing', activeAfterSaleCount: 1, pendingRefundAmount: 100,
    items: [{ ...snapshot, remainingQuantity: 2, fulfillableQuantity: 2 }],
    buttonVOs: [
      { type: 3, name: '确认收货' }, { type: 4, name: '申请售后' },
      { type: 5, name: '查看退款' }, { type: 9, name: '再次购买' },
    ],
  });
  assert.equal(processingOrder.orderStatusName, '售后处理中');
  assert.equal(processingOrder.hasPendingRefund, true);
  assert.ok(!processingOrder.buttonVOs.some((button) => Number(button.type) === 4), 'active claims must prevent another submission');
  assert.ok(!processingOrder.buttonVOs.some((button) => Number(button.type) === 3), 'do not confirm receipt while after-sales work is active');
  assert.ok(!processingOrder.buttonVOs.some((button) => Number(button.type) === 5), 'do not open a detail without a specific after-sale id');
  const noRemainingOrder = orderListApi.normalizeOrder({ ...currentOrder, status: 'paid', items: [{ ...snapshot, fulfillableQuantity: 0 }], buttonVOs: [{ type: 4, name: '申请售后' }] });
  assert.ok(!noRemainingOrder.buttonVOs.some((button) => Number(button.type) === 4));
  const pendingReviewDetail = orderListApi.normalizeOrder({ ...currentOrder, status: 'paid', afterSalesList: [{ status: 'pending_review' }], items: [snapshot] });
  assert.equal(pendingReviewDetail.orderStatusName, '退款审核中');
  console.log('PASS active after-sales list label and action filtering; detailed pending-review label preserved');
  respond = async () => ({ ...currentOrder, status: 'received', hasPendingComments: false, items: [snapshot],
    addressSnapshot: { receiver: '收货人', phone: '13800000000', province: '广东省', city: '深圳市', district: '南山区', detail: '测试街道' } });
  const received = await load('pages/order/services/orderDetail.ts').fetchOrderDetail({ orderNo: 'o1' });
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
    ? { items: [{ _id: 'r1', type: 20, status: 'pending_review', items: [snapshot], images: [] }] } : { _id: 'r1', type: 20, status: 'pending_review', items: [snapshot], images: ['cloud://proof.webp'] };
  const rights = await load('pages/order/after-service-detail/api.ts').getRightsDetail({ rightsNo: 'r1' });
  assert.equal(rights.data[0].rightsItem[0].goodsName, '商品');
  assert.equal(rights.data[0].rightsItem[0].goodsPictureUrl, 'https://example.test/cover.webp');
  assert.equal(rights.data[0].rights.rightsImageUrls[0], 'https://example.test/proof.webp');
  const rightsList = await load('pages/order/after-service-list/api.ts').getRightsList();
  assert.equal(rightsList.data.dataList[0].rightsItem[0].goodsPictureUrl, 'https://example.test/cover.webp');
  respond = async () => ({ _id: 'r1', orderNo: 'o1', type: 10, status: 'approved', amount: 200, createdAt: '2026-01-01', items: [snapshot], images: [], returnAddressSnapshot: { receiver: '退货收件人', phone: '13800000000', detail: '完整退货地址' } });
  load('pages/order/after-service-detail/index.ts');
  const returnDetail = instance(page);
  returnDetail.rightsNo = 'r1';
  await returnDetail.getService();
  assert.equal(returnDetail.data.service.receiverName, '退货收件人');
  assert.equal(returnDetail.data.service.receiverAddress, '完整退货地址');
  respond = async () => ({ items: [snapshot, { ...snapshot, skuId: 's2', skuSnapshot: { _id: 's2' } }] });
  const preview = await load('pages/order/apply-service/api.ts').fetchRightsPreview({ orderNo: 'o1', skuId: 's1' });
  assert.equal(preview.data.goodsList.length, 1);
  assert.equal(preview.data.goodsList[0].skuId, 's1');
  assert.equal(preview.data.goodsList[0].goodsInfo.skuImage, 'https://example.test/cover.webp');
  assert.equal(preview.data.refundableAmount, 200);
  respond = async () => ({ items: [{ ...snapshot, quantity: 3, refundedQuantity: 1, remainingQuantity: 2, availableRefundQuantity: 2, fulfillableQuantity: 2 }] });
  const remainingPreview = await load('pages/order/apply-service/api.ts').fetchRightsPreview({ orderNo: 'o1' });
  assert.equal(remainingPreview.data.goodsList[0].boughtQuantity, 2);
  assert.equal(remainingPreview.data.goodsList[0].refundableAmount, 200);
  respond = async () => ({
    numOfSku: 3,
    numOfSkuAvailable: 3,
    refundableAmount: 300,
    items: [{
      ...snapshot, quantity: 3, unitPrice: 100, amount: 300,
      availableRefundQuantity: 2, remainingQuantity: 3, pendingRefundQuantity: 1, fulfillableQuantity: 3,
    }],
  });
  const partialPreview = await load('pages/order/apply-service/api.ts').fetchRightsPreview({ orderNo: 'o1', skuId: 's1' });
  assert.equal(partialPreview.data.numOfSkuAvailable, 2);
  assert.equal(partialPreview.data.goodsList[0].boughtQuantity, 2);
  assert.equal(partialPreview.data.goodsList[0].refundableAmount, 200, 'refund maximum must use available quantity times unit price');
  console.log('PASS partial-refund preview uses backend available quantity and recomputes the maximum amount');
  let orderDetailStatus = 'paid';
  respond = async (action) => action === 'orders.detail' ? ({
    ...currentOrder, orderNo: 'order-refund', status: orderDetailStatus,
    items: [{ ...snapshot, quantity: 3, availableRefundQuantity: 2, remainingQuantity: 3, pendingRefundQuantity: 1, fulfillableQuantity: 3 }],
  }) : {};
  load('pages/order/order-detail/index.ts');
  const orderDetailDefinition = page;
  const showLifecyclePage = instance(orderDetailDefinition);
  let showRefreshes = 0;
  showLifecyclePage.onRefresh = () => { showRefreshes++; };
  showLifecyclePage.onShow();
  assert.equal(showRefreshes, 0, 'first onShow must not duplicate onLoad initialization');
  showLifecyclePage.onShow();
  assert.equal(showRefreshes, 1, 'returning to order detail must refresh its server snapshot');
  console.log('PASS order detail skips its initial show and refreshes on subsequent shows');
  const orderDetailPage = instance(page);
  orderDetailPage.orderNo = 'order-refund';
  await orderDetailPage.getDetail();
  assert.equal(orderDetailPage.data._order.goodsList[0].fulfillableQuantity, 3);
  assert.equal(orderDetailPage.data.order.orderStatus, 10);
  orderDetailStatus = 'completed';
  await orderDetailPage.getDetail();
  assert.equal(orderDetailPage.data.order.orderStatus, 50);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'pages/order/order-detail/index.wxml'), 'utf8'), /catchtap="onApplyGoodsRefund"/);
  console.log('PASS current single-SKU orders use order-level actions and preserve received status');
  let submittedClaim;
  respond = async (action, payload) => { assert.equal(action, 'afterSales.create'); submittedClaim = payload; return {}; };
  await load('pages/order/apply-service/api.ts').dispatchApplyService({
    rights: { orderNo: 'o1', rightsType: 20, refundRequestAmount: 100, rightsReasonDesc: '质量问题', rightsImageUrls: [] },
    rightsItem: [{ skuId: 's1', productId: 'p1', rightsQuantity: 1 }],
  });
  assert.equal(submittedClaim.refundRequestAmount, 100);
  assert.equal(submittedClaim.rightsItem[0].rightsQuantity, 1);
  respond = async (action, payload) => {
    assert.equal(action, 'afterSales.withdraw');
    assert.equal(payload.afterSaleId, 'r1');
    return {};
  };
  await load('pages/order/after-service-detail/api.ts').cancelRights({ rightsNo: 'r1' });
  assert.equal(snapshot.productSnapshot.primaryImage, 'local://cover.webp');
  const goods = load('services/good/resolveImages.ts');
  const home = await goods.resolveHomeContentImages({ config: { banners: [{ image: 'local://banner.webp' }], promos: [] }, productsById: {} });
  assert.equal(home.config.banners[0].image, 'https://example.test/banner.webp');
  const categories = await goods.resolveCategoryListImages([{ image: 'cloud://parent.webp', children: [{ image: 'local://child.webp' }] }]);
  assert.equal(categories[0].image, 'https://example.test/parent.webp');
  const wxs = { module: { exports: {} }, getRegExp: (source, flags) => new RegExp(source, flags) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/webp-image/utils.wxs'), 'utf8'), wxs);
  const transform = wxs.module.exports;
  const cosThumb = load('pages/order/utils/format.ts').cosThumb;
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
  const orderpage = instance(orderDetailDefinition); orderpage.orderNo = 'missing'; orderpage.getStoreDetail = () => {};
  await orderpage.init();
  assert.equal(orderpage.data.pageLoading, false); assert.equal(orderpage.data.loadError, '订单不存在');
  respond = async () => ({ ...currentOrder, items: [snapshot] });
  await orderpage.init(); assert.equal(orderpage.data.loadError, '');
  assert.equal(orderpage.data._order.goodsList[0].thumb, 'https://example.test/cover.webp');
  load('pages/goods/details/index.ts');
  const productPage = instance(page);
  productPage.data.details = { primaryImage: 'https://example.test/cover.webp', desc: ['', 'https://example.test/detail.webp'] };
  productPage.data.skuArray = [{ skuImage: 'https://example.test/sku.webp' }, { skuImage: 'https://example.test/cover.webp' }];
  for (const src of ['cover', 'detail']) {
    productPage.previewProductImage({ currentTarget: { dataset: { src: `https://example.test/${src}.webp` } } });
    assert.equal(imagePreviews.at(-1).current, `https://example.test/${src}.webp`);
    assert.deepEqual(Array.from(imagePreviews.at(-1).urls), ['https://example.test/cover.webp', 'https://example.test/detail.webp', 'https://example.test/sku.webp']);
  }
  load('pages/goods/details/components/goods-specs-popup/index.ts');
  component.methods.previewImage.call({ properties: { src: 'https://example.test/sku.webp' }, triggerEvent(name, detail) {
    assert.equal(name, 'previewImage'); productPage.previewProductImage({ detail });
  } });
  assert.equal(imagePreviews.at(-1).current, 'https://example.test/sku.webp');
  productPage.previewProductImage({ currentTarget: { dataset: { src: '' } } });
  assert.equal(imagePreviews.length, 3);
  imagePreviews.at(-1).fail();
  console.log('PASS image URLs, snapshot adapters, comment IDs, async races, home failure and retry, product image preview');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
