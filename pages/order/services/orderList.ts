// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveOrderImages } from '../../../utils/images';

const STATUS_CODES = { paid: 10, shipped: 40, received: 50, completed: 50, refunded: 60 };
const STATUS_LABELS = { 0: '订单状态不可用', 10: '待发货', 40: '待收货', 50: '已完成', 60: '已退款' };

function normalizeItem(item) {
  const product = item.productSnapshot;
  const sku = item.skuSnapshot;
  return {
    ...item,
    id: `${item.productId}-${item.skuId}`,
    spuId: item.productId,
    goodsPictureUrl: sku.skuImage || product.primaryImage || '',
    goodsName: product.title,
    specifications: sku.specInfo,
    buyQuantity: item.quantity,
    returnedQuantity: 0,
    actualPrice: item.unitPrice,
    itemPaymentAmount: item.amount,
  };
}

function buttonsForStatus(status, order, items, hasActiveAfterSale) {
  if (status === 10 && !hasActiveAfterSale && items.some((item) => item.fulfillableQuantity > 0)) return [{ type: 4, name: '取消订单', primary: false }];
  if (status === 40 && !hasActiveAfterSale) return [{ type: 3, name: '确认收货', primary: true }];
  if (status === 50) return order.hasPendingComments
    ? [{ type: 6, name: '评价', primary: true }]
    : [{ type: 10, name: '查看评价', primary: true }];
  return [];
}

// 当前云端订单结构到小程序组件展示结构的单向转换。
export function normalizeOrder(order) {
  const orderStatus = STATUS_CODES[order.status] || 0;
  const items = order.items.map(normalizeItem);
  const address = order.addressSnapshot;
  const logistics = order.logistics || {};
  const hasPendingReview = order.afterSalesList?.some((record) => record.status === 'pending_review') || order.activeAfterSaleStatus === 'pending_review';
  const hasActiveAfterSale = hasPendingReview || Number(order.activeAfterSaleCount) > 0 || order.pendingRefundAmount > 0;
  const isCancelled = orderStatus === 60 && (order.closureScenario === 'cancel_order' || order.fulfillmentStatus === 'paid');
  return {
    ...order,
    orderId: order._id,
    orderStatus,
    commentableProductId: items.find((item) => item.fulfillableQuantity > 0 && !order.commentedProductIds.includes(item.spuId))?.spuId,
    orderStatusName: hasPendingReview ? '售后审核中' : hasActiveAfterSale ? '售后处理中' : isCancelled ? '已取消' : STATUS_LABELS[orderStatus],
    hasPendingRefund: hasActiveAfterSale,
    hasActiveAfterSale,
    freightFee: order.shippingFee,
    goodsAmountApp: order.subtotal,
    createTime: order.createdAt,
    orderItemVOs: items,
    buttonVOs: [
      ...buttonsForStatus(orderStatus, order, items, hasActiveAfterSale),
      ...(order.afterSalesList || []).filter((record) => record.actions?.withdraw ?? record.status === 'pending_review').map((record) => ({
        type: 12, name: '撤销售后', primary: false, rightsNo: record._id || record.rightsNo,
      })),
    ],
    logisticsVO: {
      ...logistics,
      receiverName: address.receiver,
      receiverPhone: address.phone,
      receiverProvince: address.province || '',
      receiverCity: address.city || '',
      receiverArea: address.district || '',
      receiverAddress: address.detail,
      logisticsNo: logistics.trackingNo || '',
    },
  };
}

export function fetchOrders(params = {}) {
  const parameter = params.parameter;
  return request('orders.list', parameter).then(async (data) => {
    // 兼容尚未返回售后明细的订单列表接口。
    const missingRecords = data.items.filter((order) => !Array.isArray(order.afterSalesList)
      && (Number(order.activeAfterSaleCount) > 0 || Number(order.pendingRefundAmount) > 0));
    if (missingRecords.length) {
      const records = [];
      let page = 1;
      let result;
      do {
        result = await request('afterSales.list', { status: 'pending_review', page, pageSize: 20 });
        records.push(...result.items);
        page++;
      } while (result.items.length && records.length < result.total);
      missingRecords.forEach((order) => {
        order.afterSalesList = records.filter((record) => record.orderId === order._id);
      });
    }
    return {
      data: {
        orders: await Promise.all(data.items.map((order) => resolveOrderImages(normalizeOrder(order)))),
        page: data.page,
        pageNum: data.page,
        pageSize: data.pageSize,
        totalCount: data.total,
      },
    };
  });
}

export function fetchOrdersCount(params = {}) {
  return request('orders.count', params).then((data) => ({ data: data.items }));
}
