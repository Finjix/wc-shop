const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
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
  }, { setTimeout, clearTimeout, wx: { stopPullDownRefresh() {}, showToast() {}, nextTick(fn) { fn(); },
  },
    setInterval(fn, delay) { assert.equal(delay, 2500); timers.set(++timerId, fn); return timerId; },
    clearInterval(id) { timers.delete(id); } });
  home.createSelectorQuery = () => { throw new Error('home must not measure the heading'); };
  home.getTabBar = () => ({ init() {} });
  home.onShow(); await tick();
  assert.equal(home.data.recommendations.length, 2, 'unconfigured and missing products are hidden');
  assert.equal(timers.size, 1);
  assert.equal(home.data.recommendationSlides.length, 4, 'two cards use an unambiguous native circular track');
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent, 1);
  assert.equal(home.data.recommendationSlides[1].productId, 'two');
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent, 2);
  assert.equal(home.data.recommendationSlides[2].productId, 'one');
  assert.equal(requests.length, 0, 'entering home never requests the feed');
  assert.equal(home.data.feedActivated, false, 'feed subtree is absent on entry');
  home.onFeedScroll({ detail: { scrollTop: 120 } });
  assert.equal(requests.length, 0, 'initial restored scroll offset never starts the feed');
  home.onFeedBottom(); home.loadMoreFeed();
  home.onFeedScroll({ detail: { scrollTop: 0 } });
  assert.equal(requests.length, 0, 'initial bottom/layout events cannot start the feed');
  home.onFeedScroll({ detail: { scrollTop: 20 } });
  assert.equal(home.data.feedActivated, true, 'downward browsing mounts the entire feed');
  assert.equal(requests[0].params.limit, 6);
  home.onFeedScroll({ detail: { scrollTop: 40 } });
  home.onFeedBottom(); home.onFeedBottom(); assert.equal(requests.length, 1, 'in-flight request lock');
  requests[0].resolve({ items: Array.from({ length: 6 }, (_, i) => ({ feedKey: `a${i}` })), nextCursor: 'cursor-1' }); await tick();
  home.onFeedBottom(); assert.equal(requests[1].params.limit, 6); assert.equal(requests[1].params.cursor, 'cursor-1');
  requests[1].reject(new Error('offline')); await tick(); assert.equal(home.feedItems.length, 6);
  home.onFeedBottom(); assert.equal(requests.length, 2, 'error awaits explicit retry');
  home.loadMoreFeed(); assert.equal(requests[2].params.cursor, 'cursor-1');
  assert.equal(requests[2].params.limit, 6);
  requests[2].resolve({ items: Array.from({ length: 6 }, (_, i) => ({ feedKey: `b${i}` })), nextCursor: 'cursor-2' }); await tick();
  assert.equal(home.feedItems.length, 12);
  home.onHide(); assert.equal(timers.size, 0);
  home.onFeedBottom(); assert.equal(requests.length, 3, 'hidden home cannot paginate');
  home.onShow(); assert.equal(requests.length, 3, 'returning does not reset feed or request data'); assert.equal(home.feedItems.length, 12);
  assert.equal(timers.size, 1);
  home.addFeedProductToCart({ currentTarget: { dataset: { productId: 'one & two' } } });
  assert.equal(navigation[0], '/goods/details/index?spuId=one%20%26%20two&skuAction=addCart');
  home.loadMoreFeed(); await home.loadHomePage();
  requests[3].resolve({ items: [{ feedKey: 'stale' }], nextCursor: 'stale' }); await tick();
  assert.equal(home.feedItems.length, 0, 'refresh discards obsolete in-flight response');
  home.onFeedBottom();
  assert.equal(requests.length, 4, 'refresh waits for another downward gesture');
  assert.equal(home.data.feedActivated, false, 'refresh unmounts the feed');
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
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent, 1);
  assert.equal(home.data.recommendationSlides[1].productId, 'two', 'leftward autoplay keeps configured product order');
  home.onRecommendationChange({detail:{current:1,source:'touch'}});
  assert.equal(timers.size,1,'touch resets autoplay without creating a second timer');
  timers.values().next().value(); assert.equal(home.data.recommendationCurrent,2,'autoplay continues from the touched card');
  result = { config: { recommendations: [{ image: 'one.jpg', productId: 'one' }] }, productsById: { one: { _id: 'one' } } };
  await home.loadHomePage(); assert.equal(timers.size, 0, 'one card is static');
  assert.equal(requests.length, 5, 'new load is also lazy');
  home.onFeedScroll({ detail: { scrollTop: 0 } });
  home.onFeedScroll({ detail: { scrollTop: 10 } });
  requests[5].resolve({ items: [], nextCursor: '' }); await tick();
  home.onUnload(); assert.equal(timers.size, 0);
  result = { config: { banners: ['one','two','three'].map(id=>({image:`${id}.jpg`,productId:id})), recommendations: [] }, productsById: Object.fromEntries(['one','two','three'].map(id=>[id,{_id:id}])) };
  home.visible = true;
  await home.loadHomePage();
  assert.equal(timers.size, 1, 'banners also play when recommendation cards are empty');
  timers.values().next().value(); assert.equal(home.data.current, 2);
  assert.equal(home.data.swiperProductIds[2], 'two', 'rightward banners keep configured product and image aligned');
  home.onBannerChange({detail:{current:1,source:'touch'}});
  assert.equal(timers.size, 1);
  timers.values().next().value(); assert.equal(home.data.current, 0);
  home.onHide(); assert.equal(timers.size, 0);
  result.config.banners.pop();
  home.visible = true; await home.loadHomePage();
  assert.equal(home.data.swiperSlides.length, 4, 'two banners have an unambiguous circular direction');
  timers.values().next().value(); assert.equal(home.data.current, 3);
  assert.equal(home.data.swiperProductIds[3], 'two');
  home.onUnload(); assert.equal(timers.size, 0);
  home.visible = true;
  await home.loadHomePage();
  home.activateFeed();
  home.onFeedScroll({ detail: { scrollTop: 1000 } });
  for (let batch = 0; batch < 3; batch++) {
    const pending = requests.at(-1);
    pending.resolve({ items: Array.from({ length: 6 }, (_, i) => ({ feedKey: `${batch}-${i}` })), nextCursor: `next-${batch}` });
    await tick();
    assert.equal(home.data.showBackToTop, false, 'batch count does not control button visibility');
    assert.equal(home.data.feedBatches.length, batch + 1);
    if (batch < 2) home.onFeedBottom();
  }
  home.onFeedScroll({ detail: { scrollTop: 2000 } });
  assert.equal(timers.size, 0, 'deep browsing pauses header autoplay');
  assert.equal(home.data.showBackToTop, true, 'fixed distance crossing shows button');
  home.backToTop(); assert.equal(home.data.scrollAnchor, 'home-top');
  assert.equal(home.data.showBackToTop, false, 'tap immediately hides button');
  home.onFeedScroll({ detail: { scrollTop: 1900 } });
  assert.equal(home.data.showBackToTop, false, 'returning to top does not revive button');
  home.onFeedScroll({ detail: { scrollTop: 0 } });
  assert.equal(timers.size, 1, 'returning to header resumes autoplay');
  home.onFeedScroll({ detail: { scrollTop: 1600 } });
  assert.equal(home.data.showBackToTop, false);
  home.onFeedScroll({ detail: { scrollTop: 1601 } });
  assert.equal(home.data.showBackToTop, true);
  home.onFeedScroll({ detail: { scrollTop: 1599 } });
  assert.equal(home.data.showBackToTop, false, 'manual upward scroll crosses fixed boundary');
  home.backToTop(); assert.equal(home.data.scrollAnchor, 'home-top', 'repeat anchor navigation works');
  home.onUnload();
  console.log('PASS home: zero initial feed requests, downward gesture activation, batches of 6, lock, retries, refresh, return position and timers');
}

async function testDetails() {
  let details = deferred();
  const detail = page('miniprogram/goods/details/index.ts', (ref) => {
    if (ref.endsWith('fetchGood')) return { fetchGood: () => details.promise };
    if (ref.endsWith('/common/ui/toast')) return { default() {} };
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
  for (const directory of ['components/section-symbol', 'user/components/default-avatar']) {
    const source = fs.readFileSync(`miniprogram/${directory}/index.wxml`, 'utf8') + fs.readFileSync(`miniprogram/${directory}/index.wxss`, 'utf8');
    assert.doesNotMatch(source, /<image|url\(/, 'decorative icons draw without image resources');
  }
  const search = fs.readFileSync('miniprogram/components/top-search/index.wxml', 'utf8');
  assert.equal((search.match(/\{\{marqueeText\}\}/g) || []).length, 1);
  assert.match(search, /!focus && !value && marqueeText/);
  assert.doesNotMatch(fs.readFileSync('miniprogram/components/top-search/index.wxss', 'utf8'), /animation|@keyframes/);
  const markup = fs.readFileSync('miniprogram/pages/home/home.wxml', 'utf8');
  assert.match(markup, /<view wx:if="\{\{feedActivated\}\}" class="home-gifts">/);
  assert.ok(markup.indexOf('class="home-back-top"') > markup.indexOf('</scroll-view>'), 'back-to-top stays outside the endlessly growing scroll content');
  const homeStyles = fs.readFileSync('miniprogram/pages/home/home.wxss', 'utf8');
  assert.match(homeStyles, /\.home-back-top \{[^}]*position: fixed;[^}]*top: auto;[^}]*bottom: calc\(124rpx \+ env\(safe-area-inset-bottom\)\)/);
  console.log('PASS code-drawn symbols without image resources, lazy feed subtree and static search label');
}
async function testBatchWindow() {
  let definition, observe, disconnected = false;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/components/home-feed-batch/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { Component(value) { definition = value; }, wx: { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }) } });
  const batch = { ...definition.methods, data: { mounted: true, height: 0, items: Array(6).fill({}) },
    setData(patch) { Object.assign(this.data, patch); },
    createIntersectionObserver(options) { assert.equal(options.nativeMode, true); return { relativeToViewport() { return this; }, observe(selector, callback) { observe = callback; }, disconnect() { disconnected = true; } }; },
  };
  definition.lifetimes.attached.call(batch); definition.lifetimes.ready.call(batch);
  assert.equal(batch.data.height, 702);
  observe({ intersectionRatio: 0 }); assert.equal(batch.data.mounted, false);
  assert.equal(batch.data.height, 702, 'unmounting cards preserves exact batch height');
  observe({ intersectionRatio: 1 }); assert.equal(batch.data.mounted, true);
  definition.lifetimes.detached.call(batch); assert.equal(disconnected, true);
  console.log('PASS batch window: offscreen cards unmount, restore, keep height and disconnect');
}
Promise.resolve().then(testBatchWindow).then(testHome).then(testDetails).then(testAssets).catch((error) => { console.error(error); process.exitCode = 1; });
