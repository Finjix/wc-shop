const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/src/pages/Pages.tsx', 'utf8');
assert.match(admin, /<Field label="商品标题">/);
assert.doesNotMatch(admin, /draft\.name|name: product\.name|label="商品名称"|用于分类页显示/);
const types = fs.readFileSync('admin/src/types.ts', 'utf8');
assert.doesNotMatch(types.match(/export interface ProductDraft\s*\{([^}]+)\}/)[1], /\bname:/);
assert.doesNotMatch(types.match(/export interface Product\s*\{([^}]+)\}/)[1], /\bname:/);
const markup = fs.readFileSync('miniprogram/pages/category/index.wxml', 'utf8');
assert.match(markup, /class="category-product-name">\{\{category.name\}\}<\/view>/);
assert.doesNotMatch(markup, /goods\.name|goods\.title|openGoods/);
const styles = fs.readFileSync('miniprogram/pages/category/index.wxss', 'utf8');
const rule = (selector) => styles.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))[1];
for (const selector of ['category-parent', 'category-section-title', 'category-product-name']) {
  assert.match(rule(selector), /white-space:\s*nowrap/);
  assert.doesNotMatch(rule(selector), /overflow:\s*hidden|text-overflow|line-clamp|word-break:\s*break-word/);
}
const nameRule = rule('category-product-name');
assert.match(nameRule, /text-align:\s*center/);
const fontSize = (selector) => Number(rule(selector).match(/font-size:\s*(\d+)rpx/)[1]);
assert(5 * fontSize('category-parent') <= 180 - 20, 'five Chinese characters fit the sidebar');
const sidebarWidth = Number(rule('category-sidebar').match(/width:\s*(\d+)rpx/)[1]);
const rightPadding = Number(rule('category-products').match(/padding:\s*0\s+(\d+)rpx/)[1]);
const columnGap = Number(rule('category-product-grid').match(/gap:\s*\d+rpx\s+(\d+)rpx/)[1]);
const contentWidth = 750 - sidebarWidth - rightPadding * 2 - 2;
assert(5 * fontSize('category-section-title') <= contentWidth, 'five Chinese characters fit a section heading');
assert.match(rule('category-section-title'), /color:\s*#695941/);
assert.match(rule('category-section-title'), /font-weight:\s*600/);
assert.match(rule('category-product-grid'), /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
const cardWidth = (contentWidth - columnGap * 2) / 3;
assert.equal(fontSize('category-product-name'), 26, 'captions stay readable and slightly smaller than the section heading');
assert.match(rule('category-product-card'), /padding-top:\s*100%/);
assert.match(rule('category-product-card'), /height:\s*0(?:;|\s)/);
assert.match(rule('category-product-image'), /position:\s*absolute/);
assert.match(markup, /src="\{\{category.image\}\}" mode="aspectFill"/);
assert.match(markup, /class="category-section-divider"/);
assert(5 * fontSize('category-product-name') <= cardWidth, 'five Chinese characters fit each of three card columns without clipping');
console.log('PASS product names: no category-only product name editor/validation/type; category cards display category names');
