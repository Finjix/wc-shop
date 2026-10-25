const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const normalize = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/services/good/normalize.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: normalize });
const product = { _id: 'p1', title: '商品详情长标题', name: '分类短名称', primaryImage: 'https://images.test/cover.jpg' };
const normalized = normalize.normalizeGoodsItem(product);
assert.equal(normalized.name, product.name);
assert.equal(normalized.title, product.title);
assert.equal(normalize.normalizeGoodsItem({ title: '不能作为名称的标题' }).name, undefined, 'do not add a legacy title fallback');

const imageModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/services/good/resolveImages.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: imageModule, require: () => ({ resolveImage: async (value) => value || '' }) });
async function main() {
  const [resolved] = await imageModule.resolveGoodsListImages([normalized], { preferSecondary: true });
  assert.equal(resolved.name, product.name);
  const markup = fs.readFileSync('miniprogram/pages/category/index.wxml', 'utf8');
  assert.match(markup, /class="category-product-name">\{\{goods.name\}\}<\/view>/);
  assert(markup.indexOf('category-product-name') > markup.indexOf('class="category-product-image"'), 'the name appears below the product image');
  const styles = fs.readFileSync('miniprogram/pages/category/index.wxss', 'utf8');
  const nameRule = styles.match(/\.category-product-name\s*\{([^}]+)\}/)[1];
  assert.match(nameRule, /white-space:\s*nowrap/);
  assert.match(nameRule, /overflow:\s*hidden/);
  assert.match(nameRule, /text-overflow:\s*clip/);
  assert.doesNotMatch(nameRule, /ellipsis|-webkit-line-clamp/);
  assert.match(nameRule, /text-align:\s*center/);
  assert.match(markup, /<\/view>\s*<view class="category-product-name">/, 'caption is outside the image card');
  const admin = fs.readFileSync('admin/src/pages/Pages.tsx', 'utf8');
  assert.match(admin, /<Field label="商品标题">[^\n]+\n\s*<Field label="商品名称" labelHint="用于分类页显示">/);
  assert.match(admin, /value=\{draft.name\}[^\n]+maxlength=\{10\}/);
  assert.match(admin, /draft.name.trim\(\).length > 10/);
  console.log('PASS product names: independent title/name, admin 10-character limit, image adapters preserve names, centered single-line category captions without ellipsis or title fallback');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
