const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadComponent(file) {
  let definition;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports: {}, require: () => ({ default() {} }), Promise,
    Component(value) { definition = value; },
  });
  return definition;
}
const specList = [
  { specId: 'color', title: '颜色', specValueList: [{ specValueId: 'black', specValue: '黑色' }, { specValueId: 'white', specValue: '白色' }] },
  { specId: 'size', title: '鞋码', specValueList: [{ specValueId: '38', specValue: '38' }, { specValueId: '39', specValue: '39' }] },
];
const skuList = [
  ['black38', 'black', '38', 5, 19900], ['black39', 'black', '39', 0, 20900], ['white39', 'white', '39', 2, 21900],
].map(([skuId, color, size, quantity, salePrice]) => ({ skuId, quantity, stockQuantity: quantity, salePrice,
  specInfo: [{ specId: 'color', specValueId: color }, { specId: 'size', specValueId: size }],
}));
const component = loadComponent('miniprogram/components/goods/details/goods-specs-popup/index.ts');
const events = [];
const popup = { ...component.methods, properties: { specList, skuList, isStock: true }, data: { ...component.data },
  setData(value) { Object.assign(this.data, value); }, triggerEvent(name, value) { events.push({ name, value }); },
};
popup.initData();
function click(groupId, valueId) {
  const option = popup.data.viewSpecList.find((group) => group.specId === groupId).specValueList.find((value) => value.specValueId === valueId);
  popup.toChooseItem({ currentTarget: { dataset: { id: valueId, specid: groupId, hasstock: option.hasStockObj.hasStock } } });
}
function available(groupId, valueId) {
  return popup.data.viewSpecList.find((group) => group.specId === groupId).specValueList.find((value) => value.specValueId === valueId).hasStockObj.hasStock;
}
click('color', 'black');
assert.equal(popup.data.isAllSelectedSku, false);
assert.equal(available('size', '38'), true);
assert.equal(available('size', '39'), false, 'sold-out combination is disabled');
click('size', '39');
assert.equal(popup.selectedSku.size, '', 'sold-out combination cannot be selected');
click('size', '38');
assert.equal(popup.data.stockQuantity, 5);
assert.equal(popup.data.isAllSelectedSku, true);
assert.equal(available('color', 'white'), false, 'missing white38 combination is disabled');
click('size', '38');
click('color', 'white');
assert.equal(available('size', '38'), false);
click('size', '39');
assert.equal(popup.data.stockQuantity, 2);
assert.equal(popup.data.isAllSelectedSku, true);
popup.data.buyNum = 4;
click('size', '39');
click('size', '39');
assert.equal(popup.data.buyNum, 2, 'quantity is capped to the selected combination');
assert(events.some((event) => event.name === 'changeNum' && event.value.buyNum === 2));

const cartComponent = loadComponent('miniprogram/components/cart/specs-popup/index.ts');
const cartComponentConfig = JSON.parse(fs.readFileSync('miniprogram/components/cart/specs-popup/index.json', 'utf8'));
assert.equal(cartComponentConfig.usingComponents.price, '/components/price/index');
assert.equal(cartComponentConfig.usingComponents['t-toast'], undefined);
const cart = { ...cartComponent.methods, properties: { specList, skuList, selectedSkuId: 'black38' }, data: {},
  setData(value) { Object.assign(this.data, value); }, triggerEvent(name, value) { events.push({ name, value }); },
};
cart.initOptions();
assert.equal(cart.data.selectedGoodsSku.skuId, 'black38');
cart.selectOption({ currentTarget: { dataset: { specId: 'size', valueId: '38', hasStock: true } } });
assert.equal(cart.data.isComplete, false, 'deselecting permits switching sparse combinations');
assert.equal(cart.data.currentPrice, '', 'an incomplete selection never writes undefined to setData');
cart.selectOption({ currentTarget: { dataset: { specId: 'color', valueId: 'white', hasStock: true } } });
cart.selectOption({ currentTarget: { dataset: { specId: 'size', valueId: '39', hasStock: true } } });
assert.equal(cart.data.currentPrice, 21900);
cart.confirmSelection();
assert.equal(events.at(-1).value.sku.skuId, 'white39');
console.log('PASS two-level product and cart selectors: selection order, sold-out/missing combinations, deselection, stock and price');
const optionalSpecs = JSON.parse(JSON.stringify(specList));
optionalSpecs[1].optional = true;
const optionalSkus = [
  { skuId: 'black', quantity: 7, stockQuantity: 7, salePrice: 100, specInfo: [{ specId: 'color', specValueId: 'black' }] },
  skuList[2],
];
popup.properties = { ...popup.properties, specList: optionalSpecs, skuList: optionalSkus };
popup.initData();
click('color', 'black');
assert.equal(popup.data.isAllSelectedSku, true, 'a SKU without size is complete after selecting color');
assert.equal(popup.data.stockQuantity, 7);
assert.equal(popup.data.viewSpecList[1].hidden, true, 'no size options shown for a SKU without size');
click('color', 'white');
assert.equal(popup.data.isAllSelectedSku, false);
assert.equal(popup.data.viewSpecList[1].hidden, false);
click('size', '39');
assert.equal(popup.data.stockQuantity, 2);
cart.properties = { specList: optionalSpecs, skuList: optionalSkus, selectedSkuId: 'black' };
cart.initOptions();
assert.equal(cart.data.isComplete, true);
assert.equal(cart.data.selectedGoodsSku.skuId, 'black');
assert.equal(cart.data.optionGroups[1].hidden, true);
cart.confirmSelection();
assert.equal(events.at(-1).value.sku.specInfo.length, 1);
console.log('PASS omitted optional size stays absent and single-level SKUs remain purchasable alongside two-level SKUs');

const specsWxs = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync('miniprogram/pages/_shared/utils/specs.wxs', 'utf8'), specsWxs);
const formatSpecs = specsWxs.module.exports.format;
assert.equal(formatSpecs(['黑色', '38']), '黑色 / 38');
assert.equal(formatSpecs(['200g', '']), '200g');
assert.equal(formatSpecs(['', null, '38', undefined]), '38');
assert.equal(formatSpecs([]), '');
assert.equal(formatSpecs('黑色 / 38'), '黑色 / 38');
assert.equal(formatSpecs(undefined), '');
for (const file of ['miniprogram/components/order/goods-card/index.wxml', 'miniprogram/components/cart/goods-card/index.wxml', 'miniprogram/pages/order/order-confirm/index.wxml']) {
  assert.match(fs.readFileSync(file, 'utf8'), /specFormat\.format\(goods\.specs\)/);
}
console.log('PASS primary/secondary specifications use slash separators in cart, checkout, order and after-sales cards without changing SKU data');
