import { mockProducts } from './mockProducts';

const DEFAULT_STORE = {
  storeId: '1000',
  storeName: '云mall标准版旗舰店',
};

function getSkuPrice(sku, product) {
  return sku?.priceInfo?.find((item) => item.priceType === 1)?.price ?? product?.minSalePrice ?? 0;
}

function getSkuStock(sku) {
  return Math.max(0, Number(sku?.stockInfo?.stockQuantity) || 0);
}

function getSpecInfo(sku) {
  return (sku?.specInfo || []).map((item) => ({
    specId: item.specId,
    specTitle: item.specTitle || '',
    specValueId: item.specValueId,
    specValue: item.specValue || '',
  }));
}

export function createMockCartGoods(goods = {}) {
  const product = mockProducts.find((item) => String(item.spuId) === String(goods.spuId));
  const sku = product?.skuList?.find((item) => String(item.skuId) === String(goods.skuId)) || product?.skuList?.[0];
  const price = getSkuPrice(sku, product);
  const stockQuantity = sku ? getSkuStock(sku) : Math.max(0, Number(goods.stockQuantity) || 0);
  const spuId = product?.spuId ?? goods.spuId;
  const skuId = sku?.skuId ?? goods.skuId;
  const quantity = Math.max(1, Number(goods.quantity) || 1);

  return {
    ...goods,
    uid: goods.uid || `${spuId}-${skuId}`,
    saasId: goods.saasId || '88888888',
    storeId: goods.storeId ?? DEFAULT_STORE.storeId,
    storeName: goods.storeName || DEFAULT_STORE.storeName,
    spuId,
    skuId: String(skuId),
    isSelected: goods.isSelected ?? 1,
    thumb: goods.thumb || sku?.skuImage || product?.primaryImage || '',
    primaryImage: goods.primaryImage || sku?.skuImage || product?.primaryImage || '',
    title: goods.title || product?.title || '',
    quantity,
    stockStatus: stockQuantity > 0,
    stockQuantity,
    stockKnown: true,
    price: String(price),
    unitPrice: price,
    specInfo: sku ? getSpecInfo(sku) : (goods.specInfo || []),
    skuSnapshot: {
      ...(goods.skuSnapshot || {}),
      skuId: String(skuId),
      skuImage: goods.thumb || sku?.skuImage || product?.primaryImage || '',
      price,
      stockQuantity,
      specInfo: sku ? getSpecInfo(sku) : (goods.specInfo || []),
    },
  };
}

export function createMockCart() {
  const product = mockProducts[0];
  const sku = product?.skuList?.[0];
  return {
    storeGoods: [
      {
        ...DEFAULT_STORE,
        promotionGoodsList: [
          {
            promotionId: 'mock-default-promotion',
            promotionName: '精选商品',
            goodsPromotionList: [createMockCartGoods({
              spuId: product?.spuId,
              skuId: sku?.skuId,
              quantity: 1,
              isSelected: 1,
            })],
          },
        ],
        shortageGoodsList: [],
      },
    ],
    invalidGoodItems: [],
  };
}

export const mockCart = createMockCart();

export function cloneMockCart() {
  return JSON.parse(JSON.stringify(mockCart));
}
