// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveOrderImages } from '../../../utils/images';

const STATUS_LABELS = { 0: '订单状态不可用', 10: '待发货', 40: '待收货', 50: '已完成', 60: '已退款' };

function dataOf(response) {
  const value = response?.data ?? response;
  return value?.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value;
}

function statusOf(status) {
  if (typeof status === 'number') return [10, 40, 50, 60].includes(status) ? status : 0;
  const aliases = {
    PAID: 10,
    PARTIALLY_REFUNDED: 10,
    PENDING_DELIVERY: 10,
    SHIPPED: 40,
    PENDING_RECEIPT: 40,
    RECEIVED: 50,
    COMPLETE: 50,
    COMPLETED: 50,
    REFUNDED: 60,
  };
  const normalized = aliases[String(status ?? '').toUpperCase()] ?? Number(status);
  return [10, 40, 50, 60].includes(normalized) ? normalized : 0;
}

function normalizeItem(goods = {}) {
  const product = goods.productSnapshot || goods.product || {};
  const sku = goods.skuSnapshot || goods.sku || {};
  const productId = goods.productId || goods.spuId || product.spuId || product._id;
  const skuId = goods.skuId || sku.skuId || sku._id;
  const specifications = goods.specifications || goods.specInfo || sku.specInfo || [];
  const buyQuantity = Number(goods.buyQuantity ?? goods.quantity ?? goods.num) || 1;
  const refundedQuantity = Number(goods.refundedQuantity ?? goods.refundQuantity) || 0;
  const returnedQuantity = Number(goods.returnedQuantity ?? goods.returnQuantity) || 0;
  const rawFulfillable = goods.fulfillableQuantity ?? goods.remainingQuantity ?? goods.availableQuantity;
  const fulfillableQuantity = rawFulfillable === undefined
    ? Math.max(0, buyQuantity - refundedQuantity - returnedQuantity)
    : Math.max(0, Number(rawFulfillable) || 0);
  return {
    ...goods,
    id: goods.id ?? goods.itemId ?? `${productId || ''}-${skuId || ''}`,
    spuId: productId,
    skuId,
    goodsPictureUrl: goods.goodsPictureUrl || goods.thumb || goods.image || goods.primaryImage || sku.skuImage || product.primaryImage || (product.images || [])[0] || '',
    goodsName: goods.goodsName || goods.title || product.title || '',
    specifications: Array.isArray(specifications) ? specifications : [],
    buyQuantity,
    refundedQuantity,
    returnedQuantity,
    fulfillableQuantity,
    actualPrice: goods.actualPrice ?? goods.unitPrice ?? goods.price ?? goods.settlePrice ?? 0,
    itemPaymentAmount: goods.itemPaymentAmount ?? goods.amount ?? ((Number(goods.unitPrice ?? goods.price ?? 0) || 0) * (Number(goods.buyQuantity ?? goods.quantity ?? goods.num) || 1)),
  };
}

function pagingOf(parameter = {}) {
  const page = Number(parameter.page ?? parameter.pageNum) || 1;
  const pageSize = Number(parameter.pageSize) || 20;
  return {
    page: Math.max(1, page),
    pageSize: Math.min(100, Math.max(1, pageSize)),
  };
}

function buttonsForStatus(orderStatus, order, items) {
  if (orderStatus === 10) return [{ type: 4, name: '申请退款', primary: true }];
  if (orderStatus === 40) return [
    { type: 3, name: '确认收货', primary: true },
  ];
  if (orderStatus === 50) {
    const commented = order.commentedProductIds || [];
    const pending = items.some((item) => item.fulfillableQuantity > 0 && !commented.includes(item.spuId));
    const buttons = order.hasPendingComments === false || !pending
      ? [{ type: 10, name: '查看评价', primary: true }]
      : [{ type: 6, name: '评价', primary: true }];
    return buttons;
  }
  return [];
}

function visibleButtons(buttons = []) { return buttons; }

function filterOrderButtons(buttons = [], orderStatus, order, items, hasActiveAfterSale) {
  const hasEligibleGoods = items.some((item) => item.fulfillableQuantity > 0);
  return visibleButtons(buttons).filter((button) => {
    const type = Number(button.type);
    if (type === 2) return false;
    if (type === 3 && hasActiveAfterSale) return false;
    if (type === 4 && (orderStatus !== 10 || !hasEligibleGoods || hasActiveAfterSale)) return false;
    if (type === 5 && !(order.rightsNo || order.afterSaleId)) return false;
    if (type === 9) return false;
    return true;
  }).map((button) => Number(button.type) === 4 && orderStatus === 10
    ? { ...button, name: '申请退款' } : button);
}

export function normalizeOrder(order = {}) {
  const orderStatus = statusOf(order.orderStatus ?? order.status);
  const items = (order.orderItemVOs || order.items || order.goodsList || []).map(normalizeItem);
  const address = order.addressSnapshot || {};
  const logistics = order.logisticsVO || order.logistics || {};
  const afterSales = order.afterSalesList || order.afterSales || [];
  const activeAfterSaleStatus = String(order.activeAfterSaleStatus || '').toLowerCase();
  const afterSaleStatuses = Array.isArray(afterSales)
    ? afterSales.map((record) => String(record.status || record.rightsStatus || record.userRightsStatus || '').toLowerCase())
    : [];
  const hasPendingReview = afterSaleStatuses.some((status) => ['pending_review', 'pending-review', 'pending'].includes(status))
    || activeAfterSaleStatus === 'pending_review'
    || order.hasPendingRefund === true;
  const hasActiveAfterSale = hasPendingReview
    || afterSaleStatuses.some((status) => ['approved', 'refunding', 'processing'].includes(status))
    || activeAfterSaleStatus === 'processing'
    || Number(order.activeAfterSaleCount) > 0
    || Number(order.pendingRefundAmount) > 0;
  const providedButtons = filterOrderButtons(
    Array.isArray(order.buttonVOs) && order.buttonVOs.length ? order.buttonVOs : order.buttons,
    orderStatus,
    order,
    items,
    hasActiveAfterSale,
  );
  const fallbackButtons = filterOrderButtons(buttonsForStatus(orderStatus, order, items), orderStatus, order, items, hasActiveAfterSale);
  const hasSupportedOrderStatus = orderStatus !== 0;
  return {
    ...order,
    orderId: order.orderId ?? order.id ?? order._id,
    orderNo: order.orderNo || order.orderNumber,
    orderStatus,
    commentableProductId: items.find((item) => item.fulfillableQuantity > 0 && !(order.commentedProductIds || []).includes(item.spuId))?.spuId,
    orderStatusName: !hasSupportedOrderStatus ? STATUS_LABELS[0] : hasPendingReview ? '退款审核中' : hasActiveAfterSale ? '售后处理中' : (order.orderStatusName || order.statusDesc || STATUS_LABELS[orderStatus] || ''),
    hasPendingRefund: hasActiveAfterSale,
    hasActiveAfterSale,
    paymentAmount: order.paymentAmount ?? order.amount ?? order.totalPayAmount ?? order.totalAmount ?? 0,
    totalAmount: order.totalAmount ?? order.goodsAmount ?? order.goodsAmountApp ?? 0,
    freightFee: order.freightFee ?? order.deliveryFee ?? order.shippingFee ?? 0,
    goodsAmountApp: order.goodsAmountApp ?? order.subtotal ?? order.totalAmount ?? 0,
    createTime: order.createTime || order.createdAt,
    orderItemVOs: items,
    buttonVOs: providedButtons.length ? providedButtons : fallbackButtons,
    logisticsVO: {
      ...logistics,
      receiverName: logistics.receiverName ?? address.receiver ?? address.name ?? '',
      receiverPhone: logistics.receiverPhone ?? address.phone ?? '',
      receiverProvince: logistics.receiverProvince ?? address.province ?? '',
      receiverCity: logistics.receiverCity ?? address.city ?? '',
      receiverArea: logistics.receiverArea ?? address.district ?? '',
      receiverAddress: logistics.receiverAddress ?? address.detail ?? '',
      logisticsNo: logistics.logisticsNo || logistics.trackingNo || order.tracking?.trackingNo || '',
    },
  };
}

export function fetchOrders(params = {}) {
  const parameter = params.parameter || params;
  const paging = pagingOf(parameter);
  const payload = {
    ...parameter,
    ...paging,
  };
  const requestedStatus = parameter.orderStatus ?? parameter.status;
  if (requestedStatus !== undefined && requestedStatus !== null && requestedStatus !== '' && requestedStatus !== -1) {
    payload.orderStatus = requestedStatus;
  }
  delete payload.pageNum;
  return request('orders.list', payload).then(async (response) => {
    const data = dataOf(response) || {};
    const orders = data.orders || data.list || data.items || [];
    const responsePage = Number(data.page ?? data.pageNum) || paging.page;
    return {
      data: {
        ...data,
        orders: Array.isArray(orders) ? await Promise.all(orders.map((order) => resolveOrderImages(normalizeOrder(order)))) : [],
        page: responsePage,
        pageNum: responsePage,
        pageSize: Number(data.pageSize) || paging.pageSize,
        totalCount: Number(data.totalCount ?? data.total) || 0,
      },
    };
  });
}

export function fetchOrdersCount(params = {}) {
  return request('orders.count', params).then((response) => {
    const data = dataOf(response);
    const counts = Array.isArray(data) ? data : data?.items || data?.counts || data?.tabs || data?.list || [];
    return { data: Array.isArray(counts) ? counts.map((item) => ({ ...item, tabType: statusOf(item.tabType ?? item.status ?? item.orderStatus), orderNum: Number(item.orderNum ?? item.count ?? item.total) || 0 })) : [] };
  });
}
// @ts-nocheck
