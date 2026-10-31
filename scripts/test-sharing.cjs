const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const calls = [];
const share = {};
vm.runInNewContext(compile('miniprogram/common/share.ts'), { exports: share, wx: { showShareMenu: (options) => calls.push(plain(options)) } });
share.enablePageSharing();
assert.deepEqual(calls, [{ menus: ['shareAppMessage', 'shareTimeline'] }]);
for (const [route, kind] of [
  ['tabs/home/home', 'shop'], ['tabs/category/index', 'shop'], ['pages/goods/search/index', 'shop'],
  ['pages/goods/list/index', 'catalog'], ['pages/goods/result/index', 'catalog'], ['pages/goods/details/index', 'product'],
]) {
  let definition;
  vm.runInNewContext(compile(`miniprogram/${route}.ts`), { exports: {},
    require: (ref) => ref.endsWith('/share') ? share : {}, Page: (value) => { definition = value; } });
  assert.equal(typeof definition.onShareAppMessage, 'function', `${route}: registers friend callback`);
  assert.equal(typeof definition.onShareTimeline, 'function', `${route}: registers timeline callback`);
  const context = { data: { ...definition.data, spuId: '商品 /?&1', selectedAttrStr: '1 件 黑色 / 39',
    details: { title: '测试鞋', primaryImage: 'https://images.example.test/cover.jpg?token=test' },
    keywords: '咖啡 & 礼物', categoryId: '分类/一', categoryName: '礼物分类' } };
  const friend = plain(definition.onShareAppMessage.call(context));
  const timeline = plain(definition.onShareTimeline.call(context));
  assert(!('path' in timeline), 'timeline uses current route and query, not a custom path');
  if (kind === 'shop') {
    assert.equal(friend.path, '/tabs/home/home'); assert.equal(timeline.query, '');
  } else if (kind === 'catalog') {
    assert(friend.path.startsWith('/pages/goods/result/index?'));
    const params = new URLSearchParams(friend.path.split('?')[1]);
    assert.equal(params.get('searchValue'), '咖啡 & 礼物');
    assert.equal(params.get('categoryId'), '分类/一');
    assert.equal(params.get('categoryName'), '礼物分类');
    assert.equal(timeline.query, friend.path.split('?')[1]);
  } else {
    assert.equal(friend.title, '测试鞋 黑色 / 39');
    assert.equal(friend.imageUrl, 'https://images.example.test/cover.jpg?token=test');
    assert.equal(new URLSearchParams(friend.path.split('?')[1]).get('spuId'), '商品 /?&1');
    assert.equal(new URLSearchParams(timeline.query).get('spuId'), '商品 /?&1');
    assert(!friend.path.includes('skuAction'), 'shared product never auto-opens cart popup');
    for (const image of ['local://cover.png', 'cloud://cover.png', 'http://127.0.0.1:8787/files?id=1', 'https://images.example.test/cover.webp']) {
      context.data.details.primaryImage = image;
      assert.equal(definition.onShareAppMessage.call(context).imageUrl, undefined, 'omit unsupported or inaccessible thumbnails');
    }
    context.data = { spuId: '', details: {} };
    assert.equal(definition.onShareAppMessage.call(context).path, '/tabs/home/home');
    assert.equal(definition.onShareAppMessage.call(context).title, '番薯小店');
  }
}
console.log('PASS sharing: six public pages register friend/timeline callbacks, menus, encoded product/catalog links, safe image fallback and clean parameters');
