import { mockComments } from '../data/mockComments';
import { mockCategories } from '../data/mockCategories';
import { cloneMockCart, createMockCartGoods, mockCart } from '../data/mockCart';
import { mockProducts } from '../data/mockProducts';

const DEFAULT_API_ERROR = '当前仅保留前端界面，数据服务未配置';

function getMockProductCategoryNames(product) {
  const productIndex = Number(String(product.spuId || '').replace('test-', '')) - 1;
  const category = mockCategories[productIndex % mockCategories.length];
  if (!category) return [];

  return [
    category.name,
    ...(category.children || []).flatMap((group) => [
      group.name,
      ...(group.children || []).map((item) => item.name),
    ]),
  ];
}

function matchesMockProductKeyword(product, keyword) {
  if (!keyword) return true;
  if (product.title.includes(keyword)) return true;
  return getMockProductCategoryNames(product).some((name) => name.includes(keyword));
}

function getMockProductList(params = {}) {
  const keyword = String(params.keyword || params.categoryName || '').trim();
  let products = mockProducts.filter((product) => matchesMockProductKeyword(product, keyword));
  const shouldSortByPrice = params.orderBy === 'price' || Number(params.sort) === 1;
  if (shouldSortByPrice) {
    const direction = params.direction === 'desc' || Number(params.sortType) === 1 ? -1 : 1;
    products = products.slice().sort((left, right) => direction * (left.price - right.price));
  }
  const page = Math.max(1, Number(params.page || params.pageNum) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || products.length);
  const start = (page - 1) * pageSize;

  return {
    pageNum: page,
    pageSize,
    totalCount: products.length,
    spuList: products.slice(start, start + pageSize),
  };
}

function getProductComments(params = {}) {
  const productId = String(params.productId || params.spuId || '');
  let comments = productId
    ? mockComments.filter((comment) => comment.productId === productId)
    : mockComments;
  if (params.hasImage) {
    comments = comments.filter((comment) => Array.isArray(comment.commentResources) && comment.commentResources.length);
  }
  if (params.commentLevel) {
    comments = comments.filter((comment) => Number(comment.commentScore) === Number(params.commentLevel));
  }
  return comments;
}

function getMockCommentList(params = {}) {
  const comments = getProductComments(params);
  const pageNum = Math.max(1, Number(params.pageNum || params.page) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || comments.length);
  const start = (pageNum - 1) * pageSize;
  return {
    pageNum,
    pageSize,
    totalCount: comments.length,
    pageList: comments.slice(start, start + pageSize),
  };
}

function getMockCommentCount(params = {}) {
  const comments = getProductComments(params);
  return {
    badCount: comments.filter((comment) => comment.commentScore <= 2).length,
    commentCount: comments.length,
    goodCount: comments.filter((comment) => comment.commentScore >= 4).length,
    hasImageCount: comments.filter((comment) => comment.commentResources?.length).length,
    middleCount: comments.filter((comment) => comment.commentScore === 3).length,
    uidCount: 0,
  };
}

function findMockCartGoods(spuId, skuId) {
  for (const store of mockCart.storeGoods) {
    for (const promotion of store.promotionGoodsList || []) {
      const goodsList = promotion.goodsPromotionList || [];
      const goodsIndex = goodsList.findIndex((goods) => (
        String(goods.spuId) === String(spuId) && String(goods.skuId) === String(skuId)
      ));
      if (goodsIndex >= 0) return { store, promotion, goodsList, goodsIndex, goods: goodsList[goodsIndex] };
    }
  }
  return null;
}

function getMockStore(storeId, storeName) {
  let store = mockCart.storeGoods.find((item) => String(item.storeId) === String(storeId));
  if (!store) {
    store = {
      storeId: storeId ?? '1000',
      storeName: storeName || '云mall标准版旗舰店',
      promotionGoodsList: [],
      shortageGoodsList: [],
    };
    mockCart.storeGoods.push(store);
  }
  if (!store.promotionGoodsList.length) {
    store.promotionGoodsList.push({ promotionId: 'mock-default-promotion', promotionName: '精选商品', goodsPromotionList: [] });
  }
  return store;
}

function addMockCartGoods(params) {
  const nextGoods = createMockCartGoods(params);
  const current = findMockCartGoods(nextGoods.spuId, nextGoods.skuId);
  if (current) {
    current.goods.quantity += nextGoods.quantity;
    current.goods.isSelected = 1;
    return;
  }
  const store = getMockStore(nextGoods.storeId, nextGoods.storeName);
  store.promotionGoodsList[0].goodsPromotionList.push(nextGoods);
}

function updateMockCartItemSelection(params) {
  const current = findMockCartGoods(params.spuId, params.skuId);
  if (current) current.goods.isSelected = params.isSelected ? 1 : 0;
}

function updateMockCartStoreSelection(params) {
  const store = mockCart.storeGoods.find((item) => String(item.storeId) === String(params.storeId));
  if (!store) return;
  const isSelected = params.isSelected ? 1 : 0;
  (store.promotionGoodsList || []).forEach((promotion) => {
    (promotion.goodsPromotionList || []).forEach((goods) => { goods.isSelected = isSelected; });
  });
}

function updateMockCartSelection(params) {
  const isSelected = params.isSelected ? 1 : 0;
  mockCart.storeGoods.forEach((store) => {
    (store.promotionGoodsList || []).forEach((promotion) => {
      (promotion.goodsPromotionList || []).forEach((goods) => { goods.isSelected = isSelected; });
    });
  });
}

function updateMockCartQuantity(params) {
  const current = findMockCartGoods(params.spuId, params.skuId);
  if (current) current.goods.quantity = Math.max(1, Number(params.quantity) || 1);
}

function replaceMockCartSku(params) {
  const current = findMockCartGoods(params.oldSpuId, params.oldSkuId);
  if (!current) return;
  current.goodsList[current.goodsIndex] = createMockCartGoods({
    ...current.goods,
    spuId: params.newSpuId || params.oldSpuId,
    skuId: params.newSkuId,
    quantity: params.quantity || current.goods.quantity,
  });
}

function removeMockCartGoods(params) {
  mockCart.storeGoods.forEach((store) => {
    (store.promotionGoodsList || []).forEach((promotion) => {
      promotion.goodsPromotionList = (promotion.goodsPromotionList || []).filter((goods) => (
        !(String(goods.spuId) === String(params.spuId) && String(goods.skuId) === String(params.skuId))
      ));
    });
  });
}

function createApiError(message) {
  const error = new Error(message || DEFAULT_API_ERROR);
  error.code = 'API_UNAVAILABLE';
  return error;
}

/** 前端版提供商品、分类、评价与购物车展示所需的本地测试数据。 */
export function request(action, params = {}) {
  if (action === 'products.list') {
    return Promise.resolve(getMockProductList(params));
  }
  if (action === 'products.detail') {
    const product = mockProducts.find((item) => item.spuId === String(params.spuId || ''));
    return product ? Promise.resolve(product) : Promise.reject(createApiError('商品不存在或已下架'));
  }
  if (action === 'comments.count') {
    return Promise.resolve(getMockCommentCount(params));
  }
  if (action === 'comments.list') {
    return Promise.resolve(getMockCommentList(params));
  }
  if (action === 'categories.list') {
    return Promise.resolve(mockCategories);
  }
  if (action === 'cart.get') {
    return Promise.resolve(cloneMockCart());
  }
  if (action === 'cart.add') {
    addMockCartGoods(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.updateSelection') {
    updateMockCartItemSelection(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.updateStoreSelection') {
    updateMockCartStoreSelection(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.updateAllSelection') {
    updateMockCartSelection(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.updateQuantity') {
    updateMockCartQuantity(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.replaceSku') {
    replaceMockCartSku(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.remove') {
    removeMockCartGoods(params);
    return Promise.resolve({ success: true });
  }
  if (action === 'cart.clearInvalid') {
    mockCart.invalidGoodItems = [];
    return Promise.resolve({ success: true });
  }
  return Promise.reject(createApiError());
}

export function getApiErrorMessage(error, fallback = DEFAULT_API_ERROR) {
  if (!error) return fallback;
  return error.userMessage || error.message || error.errMsg || fallback;
}
