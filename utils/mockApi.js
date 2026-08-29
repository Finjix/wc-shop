import { genAddressList } from '../model/address';
import { genCartGroupData } from '../model/cart';
import { getCategoryList } from '../model/category';
import { getGoodsAllComments, getGoodsCommentsCount, getOrderComment } from '../model/comments';
import { getGoodsDetailsComments } from '../model/detailsComments';
import { genGood } from '../model/good';
import { getGoodsList } from '../model/goods';
import { getSearchResult } from '../model/search';
import { genSettleDetail } from '../model/order/orderConfirm';
import {
  getAfterServiceDetail,
  getAfterServiceRecords,
  getAfterServiceStates,
  updateMockAfterServiceLogistics,
} from '../model/order/afterService';
import { genRightsPreview, genApplyReasonList, applyService } from '../model/order/applyService';
import { genOrderDetail, genBusinessTime } from '../model/order/orderDetail';
import { genOrders, genOrdersCount } from '../model/order/orderList';
import { genSimpleUserInfo, genUsercenter } from '../model/usercenter';
import { delay } from '../services/_utils/delay';

const MOCK_ADDRESS_LIST_KEY = 'wc-shop.mock-address-list';
const MOCK_CART_DATA_KEY = 'wc-shop.mock-cart-data';
const MOCK_SEARCH_HISTORY_KEY = 'wc-shop.mock-search-history';

const STORE = {
  saasId: '88888888',
  storeId: '1000',
  storeName: '云Mall深圳旗舰店',
  uid: '88888888205468',
};

const ORDER_STATUS_NAMES = {
  5: '待付款',
  10: '待发货',
  40: '待收货',
  50: '交易完成',
  80: '已取消',
};

const clone = (value) => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
};

function storageGet(key) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') return wx.getStorageSync(key);
  } catch (error) {
    // 开发者工具未提供 storage 时退回内存状态。
  }
  return null;
}

function storageSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') wx.setStorageSync(key, value);
  } catch (error) {
    // 开发者工具未提供 storage 时保留内存状态。
  }
}

function legacyData(response) {
  return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
}

function mockError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function firstValue(source, keys, fallback = '') {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function boolValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getMockAddressList() {
  if (!Array.isArray(getMockAddressList.memory)) {
    const saved = storageGet(MOCK_ADDRESS_LIST_KEY);
    getMockAddressList.memory = Array.isArray(saved) ? saved : genAddressList(10);
  }
  return getMockAddressList.memory;
}

function saveMockAddressList(addressList) {
  getMockAddressList.memory = clone(addressList);
  storageSet(MOCK_ADDRESS_LIST_KEY, getMockAddressList.memory);
}

function normalizeMockAddress(address = {}, existing = {}) {
  const addressId = String(firstValue(address, ['addressId', 'id', '_id'], firstValue(existing, ['addressId', 'id'], '')));
  const next = {
    ...existing,
    ...address,
    id: addressId,
    addressId,
    name: firstValue(address, ['name', 'receiver'], firstValue(existing, ['name', 'receiver'])),
    phone: firstValue(address, ['phone', 'phoneNumber'], firstValue(existing, ['phone', 'phoneNumber'])),
    phoneNumber: firstValue(address, ['phoneNumber', 'phone'], firstValue(existing, ['phoneNumber', 'phone'])),
    provinceName: firstValue(address, ['provinceName', 'province'], firstValue(existing, ['provinceName', 'province'])),
    cityName: firstValue(address, ['cityName', 'city'], firstValue(existing, ['cityName', 'city'])),
    districtName: firstValue(address, ['districtName', 'district', 'countryName'], firstValue(existing, ['districtName', 'district', 'countryName'])),
    countryName: firstValue(address, ['countryName', 'districtName', 'district'], firstValue(existing, ['countryName', 'districtName'])),
    detailAddress: firstValue(address, ['detailAddress', 'detail', 'detailInfo'], firstValue(existing, ['detailAddress', 'detail'])),
    addressTag: firstValue(address, ['addressTag', 'tag'], firstValue(existing, ['addressTag', 'tag'])),
    tag: firstValue(address, ['tag', 'addressTag'], firstValue(existing, ['tag', 'addressTag'])),
    isDefault: boolValue(address.isDefault) ? 1 : (address.isDefault === undefined ? Number(existing.isDefault) || 0 : 0),
  };
  next.address = `${next.provinceName || ''}${next.cityName || ''}${next.districtName || ''}${next.detailAddress || ''}`;
  return next;
}

function findAddress(id) {
  return getMockAddressList().find((address) => String(address.id ?? address.addressId) === String(id));
}

function saveAddress(payload, isUpdate) {
  const addressList = getMockAddressList();
  const rawId = firstValue(payload, ['addressId', 'id', '_id']);
  const addressId = rawId === '' || rawId === undefined || rawId === null ? String(addressList.length) : String(rawId);
  const index = addressList.findIndex((address) => String(address.id ?? address.addressId) === addressId);
  const nextAddress = normalizeMockAddress({ ...payload, addressId }, index > -1 ? addressList[index] : {});
  if (!isUpdate && index > -1) nextAddress.addressId = String(addressList.length);
  nextAddress.id = nextAddress.addressId;
  if (nextAddress.isDefault) addressList.forEach((address) => { address.isDefault = 0; });
  const targetIndex = addressList.findIndex((address) => String(address.id ?? address.addressId) === String(nextAddress.addressId));
  if (targetIndex > -1) addressList[targetIndex] = nextAddress;
  else addressList.push(nextAddress);
  saveMockAddressList(addressList);
  return clone(nextAddress);
}

function getMockProducts() {
  return getGoodsList(0, 100);
}

function findProductBySku(skuId, spuId) {
  const products = getMockProducts();
  let product = spuId === undefined || spuId === null || spuId === ''
    ? null
    : products.find((item) => String(item.spuId) === String(spuId));
  let sku = product && (product.skuList || []).find((item) => String(item.skuId) === String(skuId));
  if (!sku && skuId !== undefined && skuId !== null && skuId !== '') {
    for (const candidate of products) {
      const matchedSku = (candidate.skuList || []).find((item) => String(item.skuId) === String(skuId));
      if (matchedSku) {
        product = candidate;
        sku = matchedSku;
        break;
      }
    }
  }
  if (!product) product = genGood(spuId || 0);
  if (!sku) sku = (product.skuList || [])[0] || null;
  return { product, sku };
}

function skuPrice(product, sku) {
  return firstDefined(
    sku && sku.priceInfo && sku.priceInfo.find((item) => Number(item.priceType) === 1)?.price,
    product && product.minSalePrice,
    0,
  );
}

function skuSpecs(sku, product) {
  if (sku && Array.isArray(sku.specInfo) && sku.specInfo.length) return sku.specInfo;
  return (product && product.specList || []).map((spec) => ({
    specTitle: spec.title,
    specValue: (spec.specValueList || [])[0]?.specValue || '',
  }));
}

function productList(payload = {}) {
  const page = Number(payload.page ?? payload.pageNum) || 1;
  const params = {
    ...payload,
    pageNum: page,
    pageSize: Number(payload.pageSize) || 30,
  };
  if (params.sort === undefined && payload.orderBy === 'price') {
    params.sort = 1;
    params.sortType = payload.direction === 'desc' ? 1 : 0;
  }
  return clone(getSearchResult(params));
}

function getMockCartData() {
  if (!getMockCartData.memory) {
    const saved = storageGet(MOCK_CART_DATA_KEY);
    getMockCartData.memory = saved && typeof saved === 'object' ? saved : legacyData(genCartGroupData());
  }
  return getMockCartData.memory;
}

function saveMockCartData(cartData) {
  getMockCartData.memory = clone(cartData);
  storageSet(MOCK_CART_DATA_KEY, getMockCartData.memory);
}

function forEachCartItem(cartData, callback) {
  (cartData.storeGoods || []).forEach((store) => {
    (store.promotionGoodsList || []).forEach((promotion) => {
      (promotion.goodsPromotionList || []).forEach((goods, index) => callback(goods, promotion.goodsPromotionList, index, store));
    });
    (store.shortageGoodsList || []).forEach((goods, index) => callback(goods, store.shortageGoodsList, index, store));
  });
  (cartData.invalidGoodItems || []).forEach((goods, index) => callback(goods, cartData.invalidGoodItems, index, null));
}

function findCartItem(cartData, spuId, skuId) {
  let result = null;
  forEachCartItem(cartData, (goods, list, index, store) => {
    if (!result && String(goods.spuId) === String(spuId) && String(goods.skuId) === String(skuId)) {
      result = { goods, list, index, store };
    }
  });
  return result;
}

function recalculateCart(cartData) {
  let totalAmount = 0;
  let selectedGoodsCount = 0;
  let itemCount = 0;
  forEachCartItem(cartData, (goods) => {
    if (goods === undefined || goods === null) return;
    const amount = Number(goods.price || goods.unitPrice || 0) || 0;
    const quantity = Math.max(1, Number(goods.quantity) || 1);
    goods.quantity = quantity;
    totalAmount += amount * quantity;
    itemCount += 1;
    if (boolValue(goods.isSelected)) selectedGoodsCount += quantity;
  });
  const allItems = [];
  forEachCartItem(cartData, (goods) => allItems.push(goods));
  cartData.totalAmount = String(totalAmount);
  cartData.selectedGoodsCount = selectedGoodsCount;
  cartData.isNotEmpty = itemCount > 0;
  cartData.isAllSelected = allItems.length > 0 && allItems.every((goods) => boolValue(goods.isSelected));
  return cartData;
}

function createCartGoods(goods = {}) {
  const { product, sku } = findProductBySku(goods.skuId, goods.spuId);
  const price = firstDefined(goods.price, goods.unitPrice, skuPrice(product, sku), 0);
  return {
    ...goods,
    ...STORE,
    storeId: goods.storeId || STORE.storeId,
    storeName: goods.storeName || STORE.storeName,
    spuId: String(goods.spuId ?? product.spuId),
    skuId: String(goods.skuId ?? sku?.skuId ?? ''),
    title: goods.title || product.title || '',
    thumb: goods.thumb || goods.primaryImage || product.primaryImage || '',
    primaryImage: goods.primaryImage || goods.thumb || product.primaryImage || '',
    price,
    originPrice: firstDefined(goods.originPrice, product.maxLinePrice, product.minLinePrice, 0),
    quantity: Math.max(1, Number(goods.quantity) || 1),
    stockQuantity: goods.stockQuantity ?? sku?.stockInfo?.stockQuantity ?? 0,
    isSelected: goods.isSelected === undefined ? 1 : (boolValue(goods.isSelected) ? 1 : 0),
    specInfo: goods.specInfo || skuSpecs(sku, product),
  };
}

function getCartPromotion(store) {
  if (!Array.isArray(store.promotionGoodsList)) store.promotionGoodsList = [];
  let promotion = store.promotionGoodsList.find((item) => Array.isArray(item.goodsPromotionList));
  if (!promotion) {
    promotion = { goodsPromotionList: [] };
    store.promotionGoodsList.push(promotion);
  }
  if (!Array.isArray(promotion.goodsPromotionList)) promotion.goodsPromotionList = [];
  return promotion;
}

function mutateCart(action, payload = {}) {
  const cartData = getMockCartData();
  if (action === 'cart.add') {
    let store = (cartData.storeGoods || []).find((item) => String(item.storeId) === String(payload.storeId));
    if (!store) {
      if (!Array.isArray(cartData.storeGoods)) cartData.storeGoods = [];
      store = { ...STORE, promotionGoodsList: [], shortageGoodsList: [] };
      cartData.storeGoods.push(store);
    }
    const promotion = getCartPromotion(store);
    const existing = promotion.goodsPromotionList.find((item) => String(item.spuId) === String(payload.spuId) && String(item.skuId) === String(payload.skuId));
    if (existing) existing.quantity = (Number(existing.quantity) || 0) + (Number(payload.quantity) || 1);
    else promotion.goodsPromotionList.push(createCartGoods(payload));
  } else if (action === 'cart.updateSelection') {
    const item = findCartItem(cartData, payload.spuId, payload.skuId);
    if (item) item.goods.isSelected = payload.isSelected ? 1 : 0;
  } else if (action === 'cart.updateStoreSelection') {
    const store = (cartData.storeGoods || []).find((item) => String(item.storeId) === String(payload.storeId));
    if (store) {
      (store.promotionGoodsList || []).forEach((promotion) => (promotion.goodsPromotionList || []).forEach((goods) => { goods.isSelected = payload.isSelected ? 1 : 0; }));
      (store.shortageGoodsList || []).forEach((goods) => { goods.isSelected = payload.isSelected ? 1 : 0; });
    }
  } else if (action === 'cart.updateAllSelection') {
    forEachCartItem(cartData, (goods) => { goods.isSelected = payload.isSelected ? 1 : 0; });
  } else if (action === 'cart.updateQuantity') {
    const item = findCartItem(cartData, payload.spuId, payload.skuId);
    if (item) item.goods.quantity = Math.max(1, Number(payload.quantity) || 1);
  } else if (action === 'cart.replaceSku') {
    const item = findCartItem(cartData, payload.oldSpuId, payload.oldSkuId);
    if (item) {
      Object.assign(item.goods, createCartGoods({
        storeId: item.store?.storeId || STORE.storeId,
        storeName: item.store?.storeName || STORE.storeName,
        spuId: payload.newSpuId,
        skuId: payload.newSkuId,
        quantity: payload.quantity,
        isSelected: item.goods.isSelected,
      }));
    }
  } else if (action === 'cart.remove') {
    const item = findCartItem(cartData, payload.spuId, payload.skuId);
    if (item) item.list.splice(item.index, 1);
  } else if (action === 'cart.clearInvalid') {
    cartData.invalidGoodItems = [];
  } else if (action === 'cart.clear') {
    cartData.storeGoods = [];
    cartData.invalidGoodItems = [];
  }
  saveMockCartData(recalculateCart(cartData));
  return clone(cartData);
}

function getMockHistory() {
  if (!Array.isArray(getMockHistory.memory)) {
    const saved = storageGet(MOCK_SEARCH_HISTORY_KEY);
    getMockHistory.memory = Array.isArray(saved)
      ? saved
      : ['鸡', '电脑', 'iPhone12', '车载手机支架', '自然堂', '小米10', '原浆古井贡酒', '欧米伽', '华为', '针织半身裙', '氢跑鞋', '三盒处理器'];
  }
  return getMockHistory.memory;
}

function saveMockHistory(historyWords) {
  getMockHistory.memory = historyWords;
  storageSet(MOCK_SEARCH_HISTORY_KEY, historyWords);
}

const mockOrderOverrides = {};
const mockCreatedOrders = [];
let mockOrderSequence = 0;

function orderName(status) {
  return ORDER_STATUS_NAMES[status] || '';
}

function getBaseOrder(orderNo) {
  const created = mockCreatedOrders.find((order) => String(order.orderNo) === String(orderNo));
  if (created) return clone(created);
  return clone(legacyData(genOrderDetail({ parameter: orderNo })));
}

function getMockOrder(orderNo) {
  const base = getBaseOrder(orderNo);
  if (!base) return null;
  const override = mockOrderOverrides[String(orderNo)] || {};
  const next = { ...base, ...override };
  if (override.orderStatus !== undefined) {
    next.orderStatusName = orderName(override.orderStatus);
    next.statusDesc = orderName(override.orderStatus);
  }
  return next;
}

function orderList(payload = {}) {
  const pageNum = Math.max(1, Number(payload.page ?? payload.pageNum) || 1);
  const pageSize = Math.max(1, Number(payload.pageSize) || 20);
  const legacy = legacyData(genOrders({
    parameter: {
      pageNum,
      pageSize: 100,
      orderStatus: payload.orderStatus === undefined ? -1 : Number(payload.orderStatus),
    },
  })) || {};
  let orders = (legacy.orders || []).map((order) => getMockOrder(order.orderNo) || order);
  orders = orders.concat(mockCreatedOrders.map((order) => getMockOrder(order.orderNo)).filter(Boolean));
  const status = payload.orderStatus;
  if (status !== undefined && status !== null && Number(status) !== -1) orders = orders.filter((order) => Number(order.orderStatus) === Number(status));
  else orders = orders.filter((order) => ![5, 80].includes(Number(order.orderStatus)));
  return {
    ...legacy,
    pageNum,
    page: pageNum,
    pageSize,
    totalCount: orders.length,
    orders: clone(orders.slice((pageNum - 1) * pageSize, pageNum * pageSize)),
  };
}

function orderItemsFromPayload(payload = {}) {
  return (payload.items || []).map((item) => {
    const resolved = findProductBySku(item.skuId, item.spuId);
    const product = resolved.product;
    const sku = resolved.sku;
    const unitPrice = skuPrice(product, sku);
    const quantity = Math.max(1, Number(item.quantity) || 1);
    return {
      ...item,
      spuId: String(item.spuId ?? product.spuId),
      skuId: String(item.skuId ?? sku?.skuId ?? ''),
      storeId: STORE.storeId,
      storeName: STORE.storeName,
      goodsName: product.title || '',
      goodsPictureUrl: product.primaryImage || (product.images || [])[0] || '',
      specifications: skuSpecs(sku, product),
      originPrice: product.maxLinePrice || product.minLinePrice || unitPrice,
      actualPrice: unitPrice,
      goodsPaymentPrice: unitPrice,
      buyQuantity: quantity,
      itemTotalAmount: String(Number(unitPrice) * quantity),
      itemPaymentAmount: String(Number(unitPrice) * quantity),
      buttonVOs: [],
    };
  });
}

function createMockOrder(payload = {}) {
  const items = orderItemsFromPayload(payload);
  const paymentAmount = items.reduce((total, item) => total + Number(item.itemPaymentAmount || 0), 0);
  const sequence = `00${mockOrderSequence += 1}`.slice(-3);
  const orderNo = `${Date.now()}${sequence}`;
  const address = findAddress(payload.addressId) || null;
  const order = {
    ...STORE,
    parentOrderNo: orderNo,
    orderId: `${orderNo}-id`,
    orderNo,
    orderStatus: 5,
    orderStatusName: '待付款',
    status: 5,
    statusDesc: '待付款',
    totalAmount: String(paymentAmount),
    goodsAmount: String(paymentAmount),
    goodsAmountApp: String(paymentAmount),
    paymentAmount: String(paymentAmount),
    freightFee: '0',
    createTime: `${Date.now()}`,
    orderItemVOs: items,
    logisticsVO: {
      logisticsType: 1,
      logisticsNo: '',
      logisticsCompanyCode: '',
      logisticsCompanyName: '',
      receiverAddressId: address?.addressId || '',
      receiverProvince: address?.provinceName || '',
      receiverCity: address?.cityName || '',
      receiverCountry: address?.districtName || '',
      receiverAddress: address?.detailAddress || '',
      receiverPhone: address?.phone || '',
      receiverName: address?.name || '',
    },
    paymentVO: { payStatus: 0, amount: String(paymentAmount) },
    buttonVOs: [
      { primary: true, type: 1, name: '去支付' },
      { primary: false, type: 2, name: '取消订单' },
    ],
  };
  mockCreatedOrders.unshift(order);
  return clone(order);
}

function settlePreview(payload = {}) {
  const goodsRequestList = (payload.items || []).map((item) => {
    const resolved = findProductBySku(item.skuId, item.spuId);
    const product = resolved.product;
    const sku = resolved.sku;
    return createCartGoods({
      ...item,
      spuId: item.spuId ?? product.spuId,
      skuId: item.skuId ?? sku?.skuId,
      quantity: item.quantity,
      price: skuPrice(product, sku),
      originPrice: product.maxLinePrice || product.minLinePrice,
      title: product.title,
      primaryImage: product.primaryImage,
      specInfo: skuSpecs(sku, product),
    });
  });
  const response = genSettleDetail({
    userAddressReq: findAddress(payload.addressId) || null,
    goodsRequestList,
  });
  return legacyData(response);
}

let mockCommentSequence = 0;
const mockCreatedComments = [];

function commentList(payload = {}) {
  if (payload.orderNo || payload.orderId) {
    const orderNo = payload.orderNo || payload.orderId;
    const direct = getOrderComment(orderNo);
    const created = mockCreatedComments.find((item) => String(item.orderNo || item.orderId) === String(orderNo));
    return { pageNum: 1, pageSize: 1, totalCount: direct || created ? 1 : 0, items: clone(created || direct ? [created || direct] : []) };
  }
  let items;
  if (payload.queryParameter || payload.pageNum !== undefined || payload.page !== undefined || payload.hasImage !== undefined) {
    const legacy = getGoodsAllComments({ queryParameter: { ...payload.queryParameter, ...payload } });
    items = legacy.pageList || [];
  } else {
    items = getGoodsDetailsComments(payload.spuId).homePageComments || [];
  }
  const productId = payload.productId || payload.spuId;
  const created = mockCreatedComments.filter((item) => !productId || String(item.productId || item.spuId) === String(productId));
  const list = created.concat(items);
  const pageNum = Math.max(1, Number(payload.page ?? payload.pageNum) || 1);
  const pageSize = Math.max(1, Number(payload.pageSize) || 20);
  return {
    pageNum,
    page: pageNum,
    pageSize,
    totalCount: list.length,
    pageList: clone(list.slice((pageNum - 1) * pageSize, pageNum * pageSize)),
  };
}

function createMockComment(payload = {}) {
  const comment = {
    ...payload,
    id: `mock-comment-${mockCommentSequence += 1}`,
    orderId: payload.orderId || payload.orderNo,
    orderNo: payload.orderNo || payload.orderId,
    productId: payload.productId || payload.spuId,
    spuId: payload.spuId || payload.productId,
    commentContent: payload.content || payload.commentContent || '',
    commentScore: payload.rating ?? payload.commentScore ?? 5,
    commentTime: `${Date.now()}`,
    commentResources: payload.commentResources || payload.resources || [],
    userName: '测试用户',
    userHeadUrl: '',
    isAnonymity: false,
  };
  mockCreatedComments.unshift(comment);
  return clone(comment);
}

function afterSalesList(payload = {}) {
  let records = getAfterServiceRecords();
  const status = payload.status;
  if (status) {
    const statusMap = { pending_review: 10, approved: 20, refunding: 30, refunded: 50, rejected: 60 };
    const statusValue = statusMap[status] ?? Number(status);
    if (Number.isFinite(statusValue)) records = records.filter((record) => Number(record.rights?.rightsStatus) === statusValue);
  }
  const page = Math.max(1, Number(payload.page ?? payload.pageNum) || 1);
  const pageSize = Math.max(1, Number(payload.pageSize) || 10);
  return {
    page,
    pageNum: page,
    pageSize,
    totalCount: records.length,
    dataList: records.slice((page - 1) * pageSize, page * pageSize),
    states: getAfterServiceStates(),
  };
}

function afterSalesPreview(payload = {}) {
  const item = (payload.rightsItem || payload.items || [])[0] || {};
  return legacyData(genRightsPreview({
    ...payload,
    orderNo: payload.orderNo || payload.orderId,
    skuId: payload.skuId || item.skuId,
    orderLevel: payload.orderLevel,
  }));
}

function createAfterSales(payload = {}) {
  const rights = payload.rights || {
    orderNo: payload.orderNo || payload.orderId,
    refundRequestAmount: payload.refundRequestAmount || payload.refundAmount,
    receiptStatus: payload.receiptStatus,
    rightsImageUrls: payload.images || payload.rightsImageUrls || [],
    rightsReasonDesc: payload.reason || payload.description,
    rightsReasonType: payload.rightsReasonType,
    rightsType: payload.rightsType || payload.type,
    type: payload.type || payload.rightsType,
  };
  const response = applyService({
    ...payload,
    rights,
    rightsItem: payload.rightsItem || payload.items || [],
    refundMemo: payload.refundMemo || payload.description || '',
  });
  return legacyData(response);
}

function dispatchMockAction(action, payload = {}) {
  if (action === 'categories.list') return getCategoryList();
  if (action === 'products.list') return productList(payload);
  if (action === 'products.detail') {
    const product = genGood(payload.spuId || payload.productId || 0);
    return { product, skus: product.skuList || [] };
  }
  if (action === 'skus.list') {
    const product = genGood(payload.spuId || payload.productId || 0);
    return { items: product.skuList || [] };
  }
  if (action === 'home.get') {
    const productItems = getGoodsList(0, 36);
    return {
      productItems,
      imgSrcs: productItems
        .slice(0, 6)
        .map((item) => item.primaryImage || item.thumb || item.image)
        .filter(Boolean),
    };
  }

  if (action === 'searchHistory.list') return { historyWords: clone(getMockHistory()) };
  if (action === 'searchHistory.add') {
    const keyword = String(payload.keyword || '').trim();
    if (keyword) saveMockHistory([keyword, ...getMockHistory().filter((item) => item !== keyword)]);
    return { historyWords: clone(getMockHistory()) };
  }
  if (action === 'searchHistory.remove') {
    saveMockHistory(getMockHistory().filter((item) => item !== payload.keyword));
    return { historyWords: clone(getMockHistory()) };
  }
  if (action === 'searchHistory.clear') {
    saveMockHistory([]);
    return { historyWords: [] };
  }

  if (action === 'addresses.list') return clone(getMockAddressList());
  if (action === 'addresses.get') return clone(findAddress(payload.addressId));
  if (action === 'addresses.create') return saveAddress(payload, false);
  if (action === 'addresses.update') return saveAddress(payload, true);
  if (action === 'addresses.setDefault') {
    const target = findAddress(payload.addressId);
    if (!target) throw mockError('ADDRESS_NOT_FOUND', '地址不存在');
    getMockAddressList().forEach((address) => { address.isDefault = String(address.addressId) === String(payload.addressId) ? 1 : 0; });
    saveMockAddressList(getMockAddressList());
    return clone(target);
  }
  if (action === 'addresses.remove') {
    const addressList = getMockAddressList();
    const removed = addressList.find((address) => String(address.addressId) === String(payload.addressId));
    const next = addressList.filter((address) => String(address.addressId) !== String(payload.addressId));
    if (removed?.isDefault && next.length) next[0].isDefault = 1;
    saveMockAddressList(next);
    return { addressId: payload.addressId };
  }

  if (action.indexOf('cart.') === 0) return mutateCart(action, payload);

  if (action === 'comments.list') return commentList(payload);
  if (action === 'comments.count') {
    const base = getGoodsCommentsCount();
    const productId = payload.productId || payload.spuId;
    const createdCount = mockCreatedComments.filter((item) => !productId || String(item.productId || item.spuId) === String(productId)).length;
    return { ...base, commentCount: String(Number(base.commentCount || 0) + createdCount), totalCount: Number(base.commentCount || 0) + createdCount };
  }
  if (action === 'comments.create') return createMockComment(payload);

  if (action === 'user.me' || action === 'user.update') return action === 'user.update'
    ? { ...genSimpleUserInfo(), ...payload }
    : clone(genUsercenter());

  if (action === 'orders.preview') return settlePreview(payload);
  if (action === 'orders.create') return createMockOrder(payload);
  if (action === 'orders.list') return orderList(payload);
  if (action === 'orders.count') return legacyData(genOrdersCount());
  if (action === 'orders.businessTime') return legacyData(genBusinessTime());
  if (action === 'orders.detail') return getMockOrder(payload.orderNo || payload.orderId);
  if (action === 'orders.cancel' || action === 'orders.confirmReceived' || action === 'orders.delete') {
    const orderNo = payload.orderNo || payload.orderId;
    if (action === 'orders.cancel') mockOrderOverrides[String(orderNo)] = { orderStatus: 80 };
    if (action === 'orders.confirmReceived') mockOrderOverrides[String(orderNo)] = { orderStatus: 50 };
    if (action === 'orders.delete') mockOrderOverrides[String(orderNo)] = { deleted: true };
    return getMockOrder(orderNo) || { orderNo };
  }

  if (action === 'afterSales.list') return afterSalesList(payload);
  if (action === 'afterSales.detail') {
    const records = getAfterServiceDetail(payload.rightsNo);
    if (payload.includeDeliveryCompanies) {
      return {
        record: records[0] || null,
        deliveryCompanies: [
          { code: 'yunda', name: '韵达快递' },
          { code: 'shentong', name: '申通快递' },
          { code: 'zhongtong', name: '中通速递' },
          { code: 'yuantong', name: '圆通速递' },
        ],
      };
    }
    return records;
  }
  if (action === 'afterSales.reasons') return legacyData(genApplyReasonList(payload));
  if (action === 'afterSales.preview') return afterSalesPreview(payload);
  if (action === 'afterSales.create') return createAfterSales(payload);
  if (action === 'afterSales.submitTracking') return updateMockAfterServiceLogistics({
    ...payload,
    rightsNo: payload.rightsNo || payload.afterSaleId,
    logisticsNo: payload.logisticsNo || payload.trackingNo,
  }) || {};
  if (action === 'afterSales.confirmReceived') return {};

  throw mockError('MOCK_ACTION_NOT_IMPLEMENTED', `Mock 未实现操作：${action}`);
}

/** 按真实 callShop 的返回约定，异步返回旧版本地演示数据。 */
export function mockCallShop(action, payload = {}) {
  return delay().then(() => dispatchMockAction(action, payload));
}
