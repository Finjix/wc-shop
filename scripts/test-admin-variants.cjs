const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, crypto });
  return exports;
}
const { emptyVariant, groupVariantDrafts, addSecondaryVariants } = load('admin/src/lib/variant-drafts.ts');
const { groupSkusByPrimary } = load('admin/src/lib/sku.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));
const black = { ...emptyVariant(), name: '黑色', skuId: 'old-black', price: '29.90', skuImage: 'cloud://black' };
const white = { ...emptyVariant(), name: '白色', price: '39.90' };
const original = [black, white];
const added = addSecondaryVariants(original, black.groupId, '38、39，40\n41');
assert.equal(original.length, 2, 'batch addition must not mutate the current draft');
assert.equal(added.length, 5, 'the plain SKU becomes the first child, not an extra blank SKU');
assert.equal(added[0].skuId, 'old-black', 'preserve the existing SKU identity and stock');
assert.equal(added[0].localId, black.localId);
assert(added.slice(1, 4).every((item) => !item.skuId), 'new combinations must not copy stock identity');
assert(added.slice(0, 4).every((item) => item.price === '29.90' && item.skuImage === black.skuImage));
assert.equal(added[4], white);
assert.equal(new Set(added.map((item) => item.localId)).size, 5);
assert.deepEqual(plain(groupVariantDrafts(added).map((group) => group.items.length)), [4, 1]);
assert.deepEqual(plain(added.slice(0, 4).map((item) => item.secondName)), ['38', '39', '40', '41']);
const more = addSecondaryVariants(added, black.groupId, '42;43');
assert.equal(more.length, 7);
assert.equal(more[0].skuId, 'old-black');
assert.throws(() => addSecondaryVariants(added, black.groupId, '38'), /不能重复/);
assert.throws(() => addSecondaryVariants(original, black.groupId, '38,38'), /不能重复/);
assert.throws(() => addSecondaryVariants(original, black.groupId, ' ,\n'), /请填写/);
assert.throws(() => addSecondaryVariants(original, black.groupId, 'x'.repeat(81)), /80/);
assert.throws(() => addSecondaryVariants(original, black.groupId, Array.from({ length: 100 }, (_, i) => `${i}`).join(',')), /100/);
assert.throws(() => addSecondaryVariants(original, 'removed', '38'), /已移除/);
const edited = more.map((item) => item.groupId === black.groupId ? { ...item, name: '深黑色' } : item);
assert(groupVariantDrafts(edited)[0].items.every((item) => item.name === '深黑色'));

const product = { specList: [
  { specId: 'color', specValueList: [{ specValueId: 'black', specValue: '黑色' }, { specValueId: 'white', specValue: '白色' }] },
  { specId: 'size', optional: true, specValueList: [{ specValueId: '38', specValue: '38' }, { specValueId: '39', specValue: '39' }] },
] };
const sku = (id, color, size) => ({ skuId: id, stockQuantity: 5, specInfo: [
  { specId: 'color', specValueId: color }, ...(size ? [{ specId: 'size', specValueId: size }] : []),
] });
const skus = [sku('b38', 'black', '38'), sku('w', 'white'), sku('b39', 'black', '39')];
const groups = groupSkusByPrimary(product, skus);
assert.deepEqual(plain(groups.map((group) => [group.name, group.items.map((item) => item.secondaryName)])), [
  ['黑色', ['38', '39']], ['白色', ['']],
]);
assert.equal(groups[0].items[1].sku, skus[2], 'inventory grouping preserves the actual editable SKU');
assert.equal(groupSkusByPrimary(product, []).length, 0);
const legacy = { specList: [{ specValueList: [{ specValueId: 'old-id', specValue: '标准款' }] }] };
assert.equal(groupSkusByPrimary(legacy, [{ skuId: 'old-id' }])[0].name, '标准款');
console.log('PASS grouped admin variants: batch add, validation, SKU preservation, inherited defaults and inventory grouping');
