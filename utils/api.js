import { mockAddresses } from '../data/mockAddresses';
import { createMockComment, mockComments } from '../data/mockComments';
import { mockCategories } from '../data/mockCategories';
import { cloneMockCart, createMockCartGoods, mockCart } from '../data/mockCart';
import { mockProducts } from '../data/mockProducts';
import {
  buildMockSettleDetail,
  cancelMockOrder,
  confirmMockOrder,
  createMockOrderFromItems,
  getMockOrder,
  getMockOrderCounts,
  listMockOrders,
  markMockOrderCommented,
} from '../data/mockOrders';
import {
  confirmMockAfterSaleReceived,
  createMockAfterSale,
  getMockAfterSale,
  getMockAfterSaleReasons,
  getMockAfterSalePreview,
  listMockAfterSales,
  submitMockAfterSaleTracking,
} from '../data/mockAfterSales';

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
  const orderNo = params.orderNo || params.orderId;
  if (orderNo) {
    comments = comments.filter((comment) => String(comment.orderNo || comment.orderId) === String(orderNo));
  }
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

let mockPaymentSequence = 1;

function createMockPayment(params = {}) {
  const paymentNo = `MOCK-PAY-${Date.now()}-${mockPaymentSequence++}`;
  return {
    channel: 'wechat',
    mockPayment: true,
    paymentNo,
    tradeNo: paymentNo,
    payAmt: params.totalAmount || 0,
  };
}

let mockAddressSequence = mockAddresses.length + 1;

function cloneMockAddress(address) {
  return address ? { ...address } : null;
}

function buildMockAddress(params = {}, original = {}) {
  const provinceName = params.province ?? params.provinceName ?? original.provinceName ?? '';
  const cityName = params.city ?? params.cityName ?? original.cityName ?? '';
  const districtName = params.district ?? params.districtName ?? original.districtName ?? '';
  const detailAddress = params.detail ?? params.detailAddress ?? original.detailAddress ?? '';
  const name = params.receiver ?? params.name ?? original.name ?? '';
  const phone = params.phone ?? params.phoneNumber ?? original.phone ?? '';
  const addressId = params.addressId || original.addressId || `mock-address-${mockAddressSequence++}`;

  return {
    ...original,
    ...params,
    addressId,
    id: addressId,
    name,
    phone,
    phoneNumber: phone,
    provinceName,
    provinceCode: params.provinceCode ?? original.provinceCode ?? '',
    cityName,
    cityCode: params.cityCode ?? original.cityCode ?? '',
    districtName,
    districtCode: params.districtCode ?? original.districtCode ?? '',
    detailAddress,
    address: `${provinceName}${cityName}${districtName}${detailAddress}`,
    addressTag: params.addressTag ?? original.addressTag ?? '',
    postalCode: params.postalCode ?? original.postalCode ?? '',
    isDefault: params.isDefault ? 1 : 0,
  };
}

function getMockAddressList() {
  return mockAddresses.map(cloneMockAddress);
}

function createMockAddress(params) {
  const address = buildMockAddress(params);
  if (address.isDefault) {
    mockAddresses.forEach((item) => { item.isDefault = 0; });
  }
  mockAddresses.push(address);
  return cloneMockAddress(address);
}

function updateMockAddress(params) {
  const addressId = String(params.addressId || '');
  const index = mockAddresses.findIndex((item) => String(item.addressId) === addressId);
  if (index < 0) return null;

  const address = buildMockAddress(params, mockAddresses[index]);
  if (address.isDefault) {
    mockAddresses.forEach((item) => { item.isDefault = 0; });
  }
  mockAddresses[index] = address;
  return cloneMockAddress(address);
}

function removeMockAddress(params) {
  const addressId = String(params.addressId || '');
  const index = mockAddresses.findIndex((item) => String(item.addressId) === addressId);
  if (index >= 0) mockAddresses.splice(index, 1);
  return { success: true };
}

function setMockDefaultAddress(params) {
  const addressId = String(params.addressId || '');
  const address = mockAddresses.find((item) => String(item.addressId) === addressId);
  if (!address) return null;

  mockAddresses.forEach((item) => {
    item.isDefault = String(item.addressId) === addressId ? 1 : 0;
  });
  return cloneMockAddress(address);
}

/** 前端版提供商品、分类、评价、地址、购物车与订单展示所需的本地测试数据。 */
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
  if (action === 'comments.create') {
    const comment = createMockComment(params);
    markMockOrderCommented(params.orderNo || params.orderId);
    return Promise.resolve({ data: comment });
  }
  if (action === 'categories.list') {
    return Promise.resolve(mockCategories);
  }
  if (action === 'addresses.list') {
    return Promise.resolve({ addressList: getMockAddressList() });
  }
  if (action === 'addresses.get') {
    const address = mockAddresses.find((item) => String(item.addressId) === String(params.addressId));
    return Promise.resolve(cloneMockAddress(address));
  }
  if (action === 'addresses.create') {
    return Promise.resolve(createMockAddress(params));
  }
  if (action === 'addresses.update') {
    return Promise.resolve(updateMockAddress(params));
  }
  if (action === 'addresses.remove') {
    return Promise.resolve(removeMockAddress(params));
  }
  if (action === 'addresses.setDefault') {
    return Promise.resolve(setMockDefaultAddress(params));
  }
  if (action === 'orders.list') {
    return Promise.resolve({ data: listMockOrders(params) });
  }
  if (action === 'orders.count') {
    return Promise.resolve({ data: getMockOrderCounts() });
  }
  if (action === 'orders.detail') {
    const order = getMockOrder(params.orderNo || params.orderId || params.id);
    return order ? Promise.resolve({ data: { order } }) : Promise.reject(createApiError('订单不存在'));
  }
  if (action === 'orders.cancel') {
    return Promise.resolve(cancelMockOrder(params.orderNo));
  }
  if (action === 'orders.confirmReceived') {
    return Promise.resolve(confirmMockOrder(params.orderNo));
  }
  if (action === 'orders.businessTime') {
    return Promise.resolve({ data: { telphone: '400-800-8888' } });
  }
  if (action === 'orders.preview') {
    return Promise.resolve({ data: buildMockSettleDetail(params.items, params.addressId) });
  }
  if (action === 'orders.preparePayment') {
    return Promise.resolve({ data: createMockPayment(params) });
  }
  if (action === 'orders.create') {
    if (!params.paymentNo) {
      const error = createApiError('支付未完成，无法创建订单');
      error.code = 'PAYMENT_REQUIRED';
      return Promise.reject(error);
    }
    const order = createMockOrderFromItems(params.items, params.addressId);
    return order ? Promise.resolve({ data: { order } }) : Promise.reject(createApiError('订单商品不存在'));
  }
  if (action === 'afterSales.preview') {
    return Promise.resolve({ data: getMockAfterSalePreview(params) });
  }
  if (action === 'afterSales.reasons') {
    return Promise.resolve({ data: { rightsReasonList: getMockAfterSaleReasons() } });
  }
  if (action === 'afterSales.create') {
    const afterSale = createMockAfterSale(params);
    return afterSale
      ? Promise.resolve({ data: afterSale })
      : Promise.reject(createApiError('订单不存在'));
  }
  if (action === 'afterSales.list') {
    return Promise.resolve({ data: listMockAfterSales(params) });
  }
  if (action === 'afterSales.detail') {
    const afterSale = getMockAfterSale(params.rightsNo || params.afterSaleId || params.id);
    return afterSale
      ? Promise.resolve({ data: afterSale })
      : Promise.reject(createApiError('售后记录不存在'));
  }
  if (action === 'afterSales.confirmReceived') {
    return Promise.resolve(confirmMockAfterSaleReceived(params));
  }
  if (action === 'afterSales.submitTracking') {
    const afterSale = submitMockAfterSaleTracking(params);
    return afterSale
      ? Promise.resolve({ data: afterSale })
      : Promise.reject(createApiError('售后记录不存在'));
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
