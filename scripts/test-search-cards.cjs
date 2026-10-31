const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = (file) => fs.readFileSync(file, 'utf8');
const tick = () => new Promise(setImmediate);

async function main() {
  const template = read('miniprogram/components/gift-card/index.wxml');
  const styles = read('miniprogram/style/gift-card.wxss');
  for (const page of ['pages/home/home', 'goods/result/index']) {
    const markup = read(`miniprogram/${page}.wxml`);
    const css = read(`miniprogram/${page}.wxss`);
    assert.match(markup, /<import src="\.\.\/\.\.\/components\/gift-card\/index.wxml"/);
    assert.match(markup, /<template is="gift-card" data="\{\{product: item\}\}"/);
    assert.match(css, /@import '\.\.\/\.\.\/style\/gift-card.wxss'/);
    assert.doesNotMatch(css, /\.home-gift-card\s*\{/, 'card appearance has one shared source');
    const components = JSON.parse(read(`miniprogram/${page}.json`)).usingComponents;
    assert.equal(components.price, '/components/price/index');
    assert(components['t-icon']);
  }
  const markup = read('miniprogram/goods/result/index.wxml');
  assert.doesNotMatch(markup, /<goods-list|layout="horizontal"/);
  assert.match(markup, /wx:for="\{\{goodsList\}\}" wx:key="spuId"/);
  assert.match(markup, /bindscrolltolower="onReachBottom"/);
  assert.match(markup, /hasLoaded && !loading && goodsList.length === 0 && loadMoreStatus !== 3/);
  assert.match(template, /class="home-gift-card__cover"[^>]*mode="aspectFill"/);
  assert.match(template, /price="\{\{product.price\}\}"/);
  assert.match(template, /catch:tap="addFeedProductToCart"/);
  assert.match(styles, /width: calc\(\(100vw - 64rpx\) \/ 2\)/);
  assert.match(styles, /border-radius: 24rpx/);
  assert.match(styles, /-webkit-line-clamp: 2/);

  let definition;
  const requests = [], navigation = [], errors = [];
  const products = Array.from({ length: 31 }, (_, index) => ({ spuId: `product-${index}`, thumb: `${index}.jpg`, title: `商品${index}`, price: 100 + index }));
  let mode = 'success';
  const imports = {
    '../../config/navigation': { isPageNavigationEnabled: () => true },
    '../services/fetchSearchResult': { async getSearchResult(params) {
      requests.push(params);
      if (mode === 'error') throw new Error('断网');
      if (mode === 'empty') return { spuList: [], totalCount: 0 };
      return { spuList: params.pageNum === 1 ? products.slice(0, 30) : products.slice(30), totalCount: 31 };
    } },
    '../../common/services/utils/api': { getApiErrorMessage: (error) => error.message },
    '../../components/tdesign/toast/index': { default() {} },
    '../../common/utils/goods-detail-navigation': { navigateToGoodsDetail: (url) => navigation.push(url) },
    '../../common/share': { catalogShareHandlers: {}, enablePageSharing() {} },
  };
  const source = ts.transpileModule(read('miniprogram/goods/result/index.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, require: (name) => { assert(imports[name], name); return imports[name]; },
    Page(value) { definition = value; },
    wx: { getWindowInfo: () => ({ windowWidth: 375 }), getMenuButtonBoundingClientRect: () => ({ top: 24, left: 280, right: 365 }), showToast: (value) => errors.push(value) },
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
  page.onLoad({ searchValue: encodeURIComponent('礼物'), categoryId: encodeURIComponent('分类/一'), categoryName: '分类' });
  await tick();
  assert.equal(page.data.goodsList.length, 30);
  assert.equal(page.data.searchInput, '礼物', 'explicit search keywords take precedence over category names');
  assert.equal(requests[0].keyword, '礼物');
  assert.equal(requests[0].categoryId, '分类/一');
  page.onReachBottom(); await tick();
  assert.equal(requests[1].pageNum, 2);
  assert.equal(page.data.goodsList.length, 31);
  assert.equal(page.data.loadMoreStatus, 2);
  const count = requests.length;
  page.onReachBottom(); assert.equal(requests.length, count, 'all cards loaded: no further requests');
  page.navToConfiguredProduct({ currentTarget: { dataset: { productId: 'one & two' } } });
  page.addFeedProductToCart({ currentTarget: { dataset: { productId: 'one & two' } } });
  assert.deepEqual(navigation, ['/goods/details/index?spuId=one%20%26%20two', '/goods/details/index?spuId=one%20%26%20two&skuAction=addCart']);
  page.navToConfiguredProduct({ currentTarget: { dataset: {} } });
  page.addFeedProductToCart({ currentTarget: { dataset: {} } });
  assert.equal(navigation.length, 2);
  page.handleFilterChange({ detail: { layout: 0, overall: 0, sorts: 'asc', sortType: '' } }); await tick();
  assert.equal(requests.at(-1).pageNum, 1);
  assert.equal(requests.at(-1).sort, 1);
  assert.equal(requests.at(-1).sortType, 0);
  assert.equal(requests.at(-1).categoryId, '分类/一');
  assert.equal(page.data.goodsList.length, 30, 'sorting resets rather than appends cards');
  page.handleFilterChange({ detail: { layout: 0, overall: 0, sorts: '', sortType: 'new' } }); await tick();
  assert.equal(requests.at(-1).sort, 3);
  mode = 'empty';
  page.handleSubmit({ detail: { value: '新的搜索' } }); await tick();
  assert.equal(page.data.goodsList.length, 0);
  assert.equal(page.data.hasLoaded, true);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.loadMoreStatus, 0);
  mode = 'error';
  page.onRetryLoad(); await tick();
  assert.equal(page.data.loadMoreStatus, 3);
  assert.equal(errors.at(-1).title, '断网');
  mode = 'success';
  page.onRetryLoad(); await tick();
  assert.equal(page.data.goodsList.length, 30);
  for (const name of ['二级类别', '三级类别']) {
    const categoryPage = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
    categoryPage.onLoad({ categoryId: encodeURIComponent('category/1'), categoryName: encodeURIComponent(name) });
    await tick();
    assert.equal(categoryPage.data.searchInput, name, 'category navigation displays the category name in the search field');
    assert.equal(categoryPage.data.keywords, '', 'displaying the category name must not add a keyword filter');
    assert.equal(requests.at(-1).keyword, '');
    assert.equal(requests.at(-1).categoryId, 'category/1');
  }
  console.log('PASS shared home/search two-column cards: one template/style, cover/title/price/cart; detail and SKU links, category/search filters, sort, pagination, empty/error/retry states');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
