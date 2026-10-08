// @ts-nocheck

import { getTempFileUrl, request } from '../../utils/api';
import { normalizeAddress } from '../address/fetchAddress';

let pendingGoodsRequestList = null;

function dataOf(response) { return response.data; }

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
  const requestKey = params.requestKey;
  const payload = {
    items: goodsRequestList.map((goods) => ({ skuId: String(goods.skuId), quantity: goods.quantity })),
    addressId: addressIdOf(params),
    // The selected cart items are sent explicitly; the backend must not use the whole cart.
    useCart: params.useCart === true,
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
  return request(name, payload).then((data) => ({ data })).catch((error) => {
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

async function normalizePreview(response) {
  const data = dataOf(response) || {};
  const resolvedItems = Array.isArray(data.items) ? data.items : [];
  const storeGoodsList = resolvedItems.length > 0
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
          quantity: Number(item.quantity) || 1,
        };
      }),
    }]
    : [];
  const totalGoodsCount = resolvedItems.reduce((sum, item) => sum + item.quantity, 0);
  const address = data.addressSnapshot;
  return {
    data: {
      ...data,
      settleType: data.settleType === undefined ? 1 : data.settleType,
      userAddress: address ? normalizeAddress(address) : null,
      totalGoodsCount,
      totalAmount: data.totalAmount,
      totalPayAmount: data.totalAmount,
      totalSalePrice: data.totalAmount,
      totalDeliveryFee: data.shippingFee,
      storeGoodsList: await Promise.all(storeGoodsList.map(async (store) => ({
        ...store,
        skuDetailVos: await Promise.all((Array.isArray(store.skuDetailVos) ? store.skuDetailVos : []).map(async (goods) => ({
          ...goods,
          image: /^(cloud|local):\/\//i.test(goods.image || '')
            ? await getTempFileUrl(goods.image).catch(() => goods.image)
            : goods.image || '',
          skuSpecLst: Array.isArray(goods.skuSpecLst) ? goods.skuSpecLst : [],
          quantity: Number(goods.quantity ?? goods.buyQuantity) || 1,
        }))),
      }))),
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
  return action('orders.preview', payload).then(normalizePreview);
}

function normalizePaidOrder(order) {
  const orderNo = order.orderNo;
  const orderId = order._id;
  if (!orderNo && !orderId) throw domainError('ORDER_CREATE_INVALID_RESPONSE', '订单创建结果缺少订单编号');
  if (!order.payment) throw domainError('ORDER_NOT_PAID', '订单尚未确认完成，请稍后重试');
  const payment = order.payment;
  const paymentStatus = String(order.paymentStatus || payment.status || '').toLowerCase();
  const orderStatus = { paid: 10, shipped: 40, received: 50, completed: 50 }[order.status];
  if (paymentStatus !== 'paid' || !orderStatus) {
    throw domainError('ORDER_NOT_PAID', '订单尚未确认完成，请稍后重试');
  }
  return {
    ...order,
    orderNo: orderNo || orderId,
    orderId: orderId || orderNo,
    orderStatus,
    status: orderStatus,
    statusDesc: order.statusDesc || order.orderStatusName || ({ 10: '待发货', 40: '待收货', 50: '已完成' }[orderStatus]),
    orderStatusName: order.orderStatusName || order.statusDesc || ({ 10: '待发货', 40: '待收货', 50: '已完成' }[orderStatus]),
    payment,
    paymentStatus: 'paid',
  };
}

function normalizeCreatedOrder(response) {
  const data = dataOf(response) || {};
  const rawOrders = Array.isArray(data.orders) && data.orders.length ? data.orders
    : [data];
  const orders = rawOrders.map(normalizePaidOrder);
  return {
    data: {
      ...data, ...orders[0], orders,
      orderNos: orders.map((order) => order.orderNo),
      orderIds: orders.map((order) => order.orderId),
      orderCount: orders.length,
      checkoutId: data.checkoutId || orders[0].orderId,
      checkoutTotalAmount: orders.reduce((sum, order) => sum + Number(order.paymentAmount ?? order.totalAmount ?? 0), 0),
    },
  };
}

export function fetchCheckoutResult(checkoutId) {
  return action('orders.checkout', { checkoutId });
}

function validateOrderRequest(params = {}) {
  const goodsRequestList = normalizeGoodsRequestList(params.goodsRequestList);
  if (!goodsRequestList.length) return { error: domainError('EMPTY_CART', '购物车为空，请先添加商品') };
  const payload = buildOrderPayload(params, goodsRequestList);
  if (!payload.addressId) return { error: domainError('ADDRESS_REQUIRED', '请先添加收货地址') };
  if (!payload.requestKey) return { error: domainError('IDEMPOTENCY_KEY_REQUIRED', '订单请求缺少幂等键，请重试') };
  return { goodsRequestList, payload };
}

/**
 * 创建订单并由服务端完成模拟支付；库存和订单幂等由云函数负责。
 */
export function createOrder(params = {}) {
  const { payload, error } = validateOrderRequest(params);
  if (error) return Promise.reject(error);
  return action('orders.create', payload).then(normalizeCreatedOrder);
}
// @ts-nocheck
