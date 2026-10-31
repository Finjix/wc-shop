const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { readSource, resolveSource } = require('./miniprogram-test-source.cjs');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let definition;
const requests = [];
let product = { _id: 'coffee', title: '咖啡豆', primaryImage: 'local://main.webp', secondaryImage: 'cloud://secondary.webp', detailImages: ['local://description.webp'], images: ['local://main.webp', 'cloud://secondary.webp'], status: 'active', minSalePrice: 100 };
const api = {
  async request(action, payload) {
    requests.push({ action, payload });
    if (action === 'products.list') return { items: [product], total: 1, page: 1, pageSize: 100 };
    if (action === 'products.detail') return { product, skus: [] };
    return { items: [] };
  },
  async getTempFileUrl(id) { return id.includes('broken') ? '' : `https://images.test/${id.split('://')[1]}`; },
  getApiErrorMessage: (error) => error.message,
};
function load(relative) {
  const file = resolveSource(path.resolve(root, relative));
  if (file === path.join(root, 'miniprogram/services/utils/api.ts')) return api;
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(ts.transpileModule(readSource(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports,
    require(ref) {
      if (ref.endsWith('/common/ui/toast')) return { default() {} };
      if (ref.startsWith('.')) return load(`${path.resolve(path.dirname(file), ref)}.ts`);
      throw new Error(`Unexpected dependency: ${ref}`);
    },
    Page(value) { definition = value; },
    wx: {}, console,
  }, { filename: file });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const instance = (page) => ({ ...page, data: plain(page.data), setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } });
async function main() {
  const { fetchGoodsList } = load('miniprogram/services/good/fetchGoodsList.ts');
  const normal = await fetchGoodsList({ categoryId: 'category' });
  assert.equal(normal.spuList[0].thumb, 'https://images.test/main.webp', 'category search results continue to use the main cover');
  const category = await fetchGoodsList({ categoryId: 'category' });
  assert.equal(category.spuList[0].thumb, 'https://images.test/main.webp');
  assert.equal(category.spuList[0].primaryImage, 'https://images.test/main.webp');
  assert(requests.every((entry) => !Object.hasOwn(entry.payload || {}, 'preferSecondary')), 'image presentation is not part of the server filter');
  const { fetchGood } = load('miniprogram/services/good/fetchGood.ts');
  const detail = await fetchGood('coffee');
  assert.deepEqual(plain(detail.coverImages), ['https://images.test/main.webp', 'https://images.test/secondary.webp']);
  assert.deepEqual(plain(detail.desc), ['https://images.test/description.webp'], 'covers are separate from detail description images');
  const categorySource = fs.readFileSync(path.join(root, 'miniprogram/tabs/category/index.ts'), 'utf8');
  assert.doesNotMatch(categorySource, /fetchGoodsList|preferSecondary|loadGoods/, 'category page displays category images, never product covers');
  load('miniprogram/pages/goods/details/index.ts');
  const detailPage = instance(definition);
  detailPage.getDetail('coffee');
  for (let i = 0; i < 10 && !detailPage.data.detailLoaded; i++) await new Promise(setImmediate);
  assert.deepEqual(plain(detailPage.data.coverImages), ['https://images.test/main.webp', 'https://images.test/secondary.webp']);
  assert.equal(detailPage.data.primaryImage, 'https://images.test/main.webp', 'SKU popup and sharing keep the main cover');
  const { resolveGoodsListImages, resolveProductDetailImages } = load('miniprogram/services/good/resolveImages.ts');
  for (const secondaryImage of ['', undefined, 'cloud://broken.webp']) {
    const [fallback] = await resolveGoodsListImages([{ primaryImage: 'local://main.webp', secondaryImage }]);
    assert.equal(fallback.thumb, 'https://images.test/main.webp');
    const fallbackDetail = await resolveProductDetailImages({ primaryImage: 'local://main.webp', secondaryImage });
    assert.deepEqual(plain(fallbackDetail.coverImages), ['https://images.test/main.webp']);
  }
  const duplicate = await resolveProductDetailImages({ primaryImage: 'local://main.webp', secondaryImage: 'local://main.webp' });
  assert.equal(duplicate.coverImages.length, 1, 'identical covers should not produce a duplicate slide');
  const markup = fs.readFileSync(path.join(root, 'miniprogram/pages/goods/details/index.wxml'), 'utf8');
  assert.match(markup, /<swiper[^>]*coverImages\.length > 1[^>]*autoplay[^>]*interval="\{\{2500\}\}"[^>]*duration="\{\{500\}\}"/);
  assert.match(markup, /data-src="\{\{item\}\}" bindtap="previewProductImage"/);
  const admin = fs.readFileSync(path.join(root, 'admin/src/pages/Pages.tsx'), 'utf8');
  const picker = fs.readFileSync(path.join(root, 'admin/src/components/ProductCoverPicker.tsx'), 'utf8');
  assert.doesNotMatch(picker, /副封面仅用于商品详情页轮播/);
  assert.doesNotMatch(picker, /副封面用于分类页显示，未设置则使用主封面/);
  assert.match(picker, /aria-label="添加封面图片"/);
  assert.match(admin, /primaryImage: images\[0\] \|\| '', secondaryImage: images\[1\] \|\| ''/);
  assert.match(admin, /secondaryImage: product\.secondaryImage \|\| ''/);
  assert.match(admin, /image !== cover && image !== product\.secondaryImage/);
  console.log('PASS product covers: main-cover lists, category isolation, storage URL resolution, legacy/broken fallback, detail-only secondary 2.5s carousel, duplicate removal and admin fields');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
