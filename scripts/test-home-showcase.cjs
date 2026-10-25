const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('../cloudfunctions/node_modules/sharp');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const share = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/common/share.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: share, wx: {} });

function page(file, imports, extras = {}) {
  let definition;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: {}, require: (ref) => ref.endsWith('/share') ? share : imports(ref), Page(value) { definition = value; }, ...extras });
  return { ...definition, data: structuredClone(definition.data), setData(patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      const entry = /^(\w+)\[(\d+)\]$/.exec(key);
      if (entry) this.data[entry[1]][Number(entry[2])] = value;
      else this.data[key] = value;
    }
    callback?.();
  } };
}

async function testHome() {
  const requests = [], navigation = [], timers = new Map(); let timerId = 0;
  let result = { config: { banners: [], recommendations: [
    { image: 'one.jpg', productId: 'one' }, { image: 'two.jpg', productId: 'two' },
    { image: '', productId: 'one' }, { image: 'gone.jpg', productId: 'gone' },
  ] }, productsById: { one: { _id: 'one' }, two: { _id: 'two' } } };
  const home = page('miniprogram/pages/home/home.ts', (ref) => {
    if (ref.endsWith('fetchHomeContent')) return { fetchHomeContent: async () => result, fetchHomeFeed(params) {
      const pending = deferred(); requests.push({ ...pending, params }); return pending.promise;
    } };
    if (ref.endsWith('goods-detail-navigation')) return { navigateToGoodsDetail: (url) => navigation.push(url) };
    if (ref.endsWith('/api')) return { getApiErrorMessage: (e) => e.message };
    return {};
  }, { wx: { stopPullDownRefresh() {}, showToast() {} },
    setInterval(fn, delay) { assert.equal(delay, 2500); timers.set(++timerId, fn); return timerId; },
    clearInterval(id) { timers.delete(id); } });
  home.getTabBar = () => ({ init() {} });
  home.onShow(); await tick();
  assert.equal(home.data.recommendations.length, 2, 'unconfigured and missing products are hidden');
  assert.equal(timers.size, 1);
  assert.equal(home.data.recommendationSlides.length, 4, 'two cards use an unambiguous native circular track');
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent, 3);
  assert.equal(home.data.recommendationSlides[3].productId, 'two');
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent, 2);
  assert.equal(home.data.recommendationSlides[2].productId, 'one');
  assert.equal(requests.length, 0, 'entering home never requests the feed');
  home.onFeedBottom(); home.loadMoreFeed();
  home.onFeedScroll({ detail: { scrollTop: 0 } });
  assert.equal(requests.length, 0, 'initial bottom/layout events cannot start the feed');
  home.onFeedScroll({ detail: { scrollTop: 20 } });
  assert.equal(requests[0].params.limit, 6);
  home.onFeedScroll({ detail: { scrollTop: 40 } });
  home.onFeedBottom(); home.onFeedBottom(); assert.equal(requests.length, 1, 'in-flight request lock');
  requests[0].resolve({ items: Array.from({ length: 6 }, (_, i) => ({ feedKey: `a${i}` })), nextCursor: 'cursor-1' }); await tick();
  home.onFeedBottom(); assert.equal(requests[1].params.limit, 6); assert.equal(requests[1].params.cursor, 'cursor-1');
  requests[1].reject(new Error('offline')); await tick(); assert.equal(home.data.feedItems.length, 6);
  home.onFeedBottom(); assert.equal(requests.length, 2, 'error awaits explicit retry');
  home.loadMoreFeed(); assert.equal(requests[2].params.cursor, 'cursor-1');
  assert.equal(requests[2].params.limit, 6);
  requests[2].resolve({ items: Array.from({ length: 6 }, (_, i) => ({ feedKey: `b${i}` })), nextCursor: 'cursor-2' }); await tick();
  assert.equal(home.data.feedItems.length, 12);
  home.onHide(); assert.equal(timers.size, 0);
  home.onShow(); assert.equal(requests.length, 3, 'returning does not reset feed or request data'); assert.equal(home.data.feedItems.length, 12);
  assert.equal(timers.size, 1);
  home.addFeedProductToCart({ currentTarget: { dataset: { productId: 'one & two' } } });
  assert.equal(navigation[0], '/goods/details/index?spuId=one%20%26%20two&skuAction=addCart');
  home.loadMoreFeed(); await home.loadHomePage();
  requests[3].resolve({ items: [{ feedKey: 'stale' }], nextCursor: 'stale' }); await tick();
  assert.equal(home.data.feedItems.length, 0, 'refresh discards obsolete in-flight response');
  home.onFeedBottom();
  assert.equal(requests.length, 4, 'refresh waits for another downward gesture');
  home.onFeedTouchStart({ touches: [{ clientY: 100 }] });
  home.onFeedTouchMove({ touches: [{ clientY: 104 }] });
  home.onFeedTouchMove({ touches: [{ clientY: 94 }] });
  home.onFeedTouchMove({ touches: [{ clientY: 80, clientX: 100 }] });
  assert.equal(requests.length, 4, 'reverse swipes and tap jitter never activate feed');
  home.onFeedTouchMove({ touches: [{ clientY: 80 }] });
  assert.equal(requests[4].params.limit, 6, 'swiping loads even on a short non-scrollable page');
  requests[4].resolve({ items: [], nextCursor: '' }); await tick();
  home.onFeedBottom(); assert.equal(requests.length, 5, 'empty catalog stops repeated loading');
  result = { config: { recommendations: ['one','two','three'].map(id=>({image:`${id}.jpg`,productId:id})) }, productsById: Object.fromEntries(['one','two','three'].map(id=>[id,{_id:id}])) };
  await home.loadHomePage();
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent, 2);
  assert.equal(home.data.recommendationSlides[2].productId, 'two', 'rightward autoplay keeps configured product order');
  home.onRecommendationChange({detail:{current:1,source:'touch'}});
  assert.equal(timers.size,1,'touch resets autoplay without creating a second timer');
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent,0,'autoplay continues from the touched card');
  result = { config: { recommendations: [{ image: 'one.jpg', productId: 'one' }] }, productsById: { one: { _id: 'one' } } };
  await home.loadHomePage(); assert.equal(timers.size, 0, 'one card is static');
  assert.equal(requests.length, 5, 'new load is also lazy');
  home.onFeedScroll({ detail: { scrollTop: 10 } });
  requests[5].resolve({ items: [], nextCursor: '' }); await tick();
  home.onUnload(); assert.equal(timers.size, 0);
  console.log('PASS home: zero initial feed requests, downward gesture activation, batches of 6, lock, retries, refresh, return position and timers');
}

async function testDetails() {
  let details = deferred();
  const detail = page('miniprogram/goods/details/index.ts', (ref) => {
    if (ref.endsWith('fetchGood')) return { fetchGood: () => details.promise };
    if (ref.includes('/toast/')) return { default() {} };
    if (ref.endsWith('/api')) return { getApiErrorMessage: (error) => error.message };
    return {};
  }, { wx: { getWindowInfo: () => ({ statusBarHeight: 24 }), getMenuButtonBoundingClientRect: () => ({ height: 32, top: 28 }) } });
  detail.getCommentsStatistics = () => {};
  detail.onLoad({ spuId: 'one', skuAction: 'addCart' });
  assert.equal(detail.data.isSpuSelectPopupShow, false, 'wait for loaded product data');
  details.resolve({ skuList: [], primaryImage: 'cover', minSalePrice: 100, isPutOnSale: 1 }); await tick();
  assert.equal(detail.data.isSpuSelectPopupShow, true); assert.equal(detail.data.buyType, 2);
  detail.handlePopupHide(); details = deferred(); detail.getDetail('one');
  details.resolve({ skuList: [], primaryImage: 'cover' }); await tick();
  assert.equal(detail.data.isSpuSelectPopupShow, false, 'automatic action is consumed only once');
  details = deferred(); detail.onLoad({ spuId: 'two', skuAction: 'addCart' }); details.reject(new Error('offline')); await tick();
  assert.equal(detail.data.isSpuSelectPopupShow, false, 'failed details never open empty popup');
  console.log('PASS detail: add-cart popup opens after successful loading, once, with failure guard');
}

async function testAssets() {
  for (const name of ['recommend-heart', 'gift-star']) {
    const file = `miniprogram/assets/home/${name}.png`;
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, 'png'); assert.equal(meta.width, 64); assert.equal(meta.height, 64);
    assert(!meta.pages || meta.pages === 1, 'mascot is a single still');
    assert(!fs.existsSync(`miniprogram/assets/home/${name}.gif`), 'retired GIF is removed');
    const first = await sharp(file).ensureAlpha().raw().toBuffer();
    assert(first.some((v, i) => i % 4 === 3 && v === 0), 'transparent canvas');
    assert(first.some((v, i) => i % 4 === 3 && v === 255), 'visible mascot');
  }
  const search = fs.readFileSync('miniprogram/components/top-search/index.wxml', 'utf8');
  assert.equal((search.match(/\{\{marqueeText\}\}/g) || []).length, 1);
  assert.match(search, /!focus && !value && marqueeText/);
  assert.doesNotMatch(fs.readFileSync('miniprogram/components/top-search/index.wxss', 'utf8'), /animation|@keyframes/);
  console.log('PASS assets: transparent single PNGs and static search label');
}
Promise.resolve().then(testHome).then(testDetails).then(testAssets).catch((error) => { console.error(error); process.exitCode = 1; });
