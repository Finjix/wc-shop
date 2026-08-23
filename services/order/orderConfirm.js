import { callShop } from '../../utils/cloud';

let pendingGoodsRequestList = null;

function dataOf(response) {
  const value = response?.data ?? response;
  return value?.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeGoodsRequestList(list) {
  const merged = new Map();
  (Array.isArray(list) ? list : []).forEach((goods) => {
    if (!goods || goods.skuId === undefined || goods.skuId === null || goods.skuId === '') return;
    const skuId = String(goods.skuId);
    const quantity = Math.max(1, Number(goods.quantity ?? goods.num) || 1);
    const previous = merged.get(skuId);
    merged.set(skuId, {
      ...(previous || goods),
      skuId,
      quantity: (previous?.quantity || 0) + quantity,
    });
  });
  return Array.from(merged.values());
}

function addressIdOf(params = {}) {
  const address = params.userAddressReq || params.address || {};
  const id = params.addressId || address.addressId || address.id || address._id;
  return id === undefined || id === null || id === '' ? '' : String(id);
}

function buildOrderPayload(params, goodsRequestList) {
  const requestKey = params.requestKey || params.idempotencyKey;
  const payload = {
    items: goodsRequestList.map((goods) => ({ skuId: String(goods.skuId), quantity: goods.quantity })),
    addressId: addressIdOf(params),
    // The selected cart items are sent explicitly; the backend must not use the whole cart.
    useCart: false,
  };
  if (requestKey !== undefined && requestKey !== null && requestKey !== '') payload.requestKey = String(requestKey);
  if (params.remark !== undefined) payload.remark = params.remark;
  return payload;
}

function domainError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.msg = message;
  return error;
}

function action(name, payload = {}) {
  return callShop(name, payload).then((response) => ({ data: dataOf(response) })).catch((error) => {
    if (error && !error.msg) error.msg = error.message;
    throw error;
  });
}

export function setPendingGoodsRequestList(list) {
  pendingGoodsRequestList = clone(normalizeGoodsRequestList(list));
}

export function getPendingGoodsRequestList() {
  return clone(pendingGoodsRequestList);
}

export function clearPendingGoodsRequestList() {
  pendingGoodsRequestList = null;
}

function normalizePreview(response) {
  const data = dataOf(response) || {};
  const resolvedItems = Array.isArray(data.items) ? data.items : [];
  const fallbackStoreGoods = resolvedItems.length > 0
    ? [{
      storeId: 'default',
      storeName: '',
      skuDetailVos: resolvedItems.map((item) => {
        const product = item.productSnapshot || {};
        const sku = item.skuSnapshot || {};
        const specInfo = sku.specInfo || item.specInfo || [];
        return {
          ...item,
          spuId: item.productId || product.spuId || product._id,
          skuId: item.skuId || sku.skuId || sku._id,
          image: item.image || sku.skuImage || product.primaryImage || (product.images || [])[0] || '',
          goodsName: item.goodsName || product.title || '',
          skuSpecLst: Array.isArray(specInfo) ? specInfo : [],
          settlePrice: item.unitPrice ?? item.price ?? 0,
          tagPrice: item.unitPrice ?? item.price ?? 0,
          quantity: Number(item.quantity) || 1,
        };
      }),
    }]
    : [];
  const storeGoodsList = Array.isArray(data.storeGoodsList) && data.storeGoodsList.length
    ? data.storeGoodsList
    : fallbackStoreGoods;
  const totalGoodsCount = data.totalGoodsCount ?? data.goodsCount ?? resolvedItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return {
    data: {
      ...data,
      settleType: data.settleType === undefined ? 1 : data.settleType,
      userAddress: data.userAddress || data.userAddressReq || data.addressSnapshot || null,
      totalGoodsCount,
      totalAmount: data.totalAmount ?? data.goodsAmount ?? '0',
      totalPayAmount: data.totalPayAmount ?? data.paymentAmount ?? data.totalAmount ?? '0',
      totalSalePrice: data.totalSalePrice ?? data.totalAmount ?? '0',
      totalDeliveryFee: data.totalDeliveryFee ?? data.deliveryFee ?? '0',
      storeGoodsList: storeGoodsList.map((store) => ({
        ...store,
        skuDetailVos: (Array.isArray(store.skuDetailVos) ? store.skuDetailVos : []).map((goods) => ({
          ...goods,
          skuSpecLst: Array.isArray(goods.skuSpecLst) ? goods.skuSpecLst : [],
          quantity: Number(goods.quantity ?? goods.buyQuantity) || 1,
        })),
      })),
      outOfStockGoodsList: Array.isArray(data.outOfStockGoodsList) ? data.outOfStockGoodsList : [],
      abnormalDeliveryGoodsList: Array.isArray(data.abnormalDeliveryGoodsList) ? data.abnormalDeliveryGoodsList : [],
      inValidGoodsList: Array.isArray(data.inValidGoodsList) ? data.inValidGoodsList : [],
    },
  };
}

export function fetchSettleDetail(params = {}) {
  const goodsRequestList = normalizeGoodsRequestList(params.goodsRequestList);
  if (!goodsRequestList.length) return Promise.reject(domainError('EMPTY_CART', '购物车为空，请先添加商品'));
  const payload = buildOrderPayload(params, goodsRequestList);
  if (!payload.addressId) return Promise.reject(domainError('ADDRESS_REQUIRED', '请先添加收货地址'));
  return action('orders.preview', payload).then(normalizePreview);
}

function normalizeCreatedOrder(response) {
  const data = dataOf(response) || {};
  const order = data.order && typeof data.order === 'object' ? data.order : data;
  const orderNo = order.orderNo || order.orderNumber;
  const orderId = order.orderId || order.id || order._id;
  if (!orderNo && !orderId) throw domainError('ORDER_CREATE_INVALID_RESPONSE', '订单创建结果缺少订单编号');
  const orderStatus = order.orderStatus ?? order.status ?? 5;
  return {
    data: {
      ...order,
      orderNo,
      orderId,
      orderStatus,
      status: order.status ?? orderStatus,
      statusDesc: order.statusDesc || order.orderStatusName || '待支付',
    },
  };
}

export function dispatchCommitPay(params = {}) {
  const goodsRequestList = normalizeGoodsRequestList(params.goodsRequestList);
  if (!goodsRequestList.length) return Promise.reject(domainError('EMPTY_CART', '购物车为空，请先添加商品'));
  const payload = buildOrderPayload(params, goodsRequestList);
  if (!payload.addressId) return Promise.reject(domainError('ADDRESS_REQUIRED', '请先添加收货地址'));
  if (!payload.requestKey) return Promise.reject(domainError('IDEMPOTENCY_KEY_REQUIRED', '订单请求缺少幂等键，请重试'));
  return action('orders.create', payload).then(normalizeCreatedOrder);
}
