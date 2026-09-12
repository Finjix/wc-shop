const TEST_IMAGE = '/assets/home-test-image.jpg';

const SPEC_SCHEMES = [
  [
    { title: '颜色', values: ['米白', '咖啡'] },
    { title: '尺寸', values: ['小号', '大号'] },
  ],
  [
    { title: '容量', values: ['30ml', '60ml', '100ml'] },
    { title: '包装', values: ['单支装', '双支装'] },
  ],
  [
    { title: '款式', values: ['基础款', '升级款'] },
    { title: '套装', values: ['单件', '双件套', '礼盒装'] },
  ],
  [
    { title: '材质', values: ['棉质', '丝绒'] },
    { title: '颜色', values: ['米白', '咖啡'] },
  ],
];

function createSpecList(index) {
  return SPEC_SCHEMES[(index - 1) % SPEC_SCHEMES.length].map((spec, specIndex) => ({
    specId: `spec-${specIndex + 1}`,
    title: spec.title,
    specValueList: spec.values.map((value, valueIndex) => ({
      specValueId: `spec-${specIndex + 1}-value-${valueIndex + 1}`,
      specValue: value,
    })),
  }));
}

function createSkuList(spuId, specList, basePrice) {
  const combinations = specList.reduce(
    (groups, spec) => groups.flatMap((group) =>
      spec.specValueList.map((value) => group.concat({
        specId: spec.specId,
        specTitle: spec.title,
        specValueId: value.specValueId,
        specValue: value.specValue,
      }))),
    [[]],
  );

  return combinations.map((specInfo, skuIndex) => {
    const price = basePrice + skuIndex * 100;
    const stockQuantity = skuIndex === combinations.length - 1 ? 0 : 99;
    return {
      skuId: `${spuId}-sku-${skuIndex + 1}`,
      skuImage: TEST_IMAGE,
      stockInfo: { stockQuantity },
      priceInfo: [{ priceType: 1, price }],
      specInfo,
    };
  });
}

function createMockProduct(index) {
  const spuId = `test-${index}`;
  const title = Array.from({ length: index }, () => `测试${index}`).join('');
  const basePrice = 990 + index * 100;
  const specList = createSpecList(index);
  const skuList = createSkuList(spuId, specList, basePrice);
  const salePrices = skuList.map((sku) => sku.priceInfo[0].price);
  const totalStock = skuList.reduce((total, sku) => total + sku.stockInfo.stockQuantity, 0);

  return {
    spuId,
    title,
    thumb: TEST_IMAGE,
    primaryImage: TEST_IMAGE,
    desc: [TEST_IMAGE],
    minSalePrice: Math.min(...salePrices),
    price: Math.min(...salePrices),
    spuStockQuantity: totalStock,
    isPutOnSale: 1,
    available: true,
    specList,
    skuList,
  };
}

export const mockProducts = Array.from({ length: 16 }, (_, index) => createMockProduct(index + 1));
