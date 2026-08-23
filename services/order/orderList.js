import { callShop } from '../../utils/cloud';

const STATUS_LABELS = { 5: '待支付', 10: '待发货', 40: '待收货', 50: '已完成', 80: '已取消' };

function dataOf(response) {
  const value = response?.data ?? response;
  return value?.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value;
}

function statusOf(status) {
  if (typeof status === 'number') return status;
  const aliases = {
    PENDING_PAYMENT: 5,
    PAID: 10,
    PENDING_DELIVERY: 10,
    SHIPPED: 40,
    PENDING_RECEIPT: 40,
    RECEIVED: 50,
    COMPLETE: 50,
    COMPLETED: 50,
    CANCELED: 80,
    CANCELLED: 80,
  };
  return aliases[String(status ?? '').toUpperCase()] ?? (Number(status) || 80);
}

function normalizeItem(goods = {}) {
  const product = goods.productSnapshot || goods.product || {};
  const sku = goods.skuSnapshot || goods.sku || {};
  const productId = goods.productId || goods.spuId || product.spuId || product._id;
  const skuId = goods.skuId || sku.skuId || sku._id;
  const specifications = goods.specifications || goods.specInfo || sku.specInfo || [];
  return {
    ...goods,
    id: goods.id ?? goods.itemId ?? `${productId || ''}-${skuId || ''}`,
    spuId: productId,
    skuId,
    goodsPictureUrl: goods.goodsPictureUrl || goods.thumb || goods.image || goods.primaryImage || sku.skuImage || product.primaryImage || (product.images || [])[0] || '',
    goodsName: goods.goodsName || goods.title || product.title || '',
    specifications: Array.isArray(specifications) ? specifications : [],
    buyQuantity: Number(goods.buyQuantity ?? goods.quantity ?? goods.num) || 1,
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

function buttonsForStatus(orderStatus) {
  if (orderStatus === 5) return [{ type: 1, name: '去支付', primary: true }, { type: 2, name: '取消订单' }];
  if (orderStatus === 40) return [{ type: 3, name: '确认收货', primary: true }];
  if (orderStatus === 50) return [{ type: 6, name: '评价', primary: true }, { type: 7, name: '删除订单' }];
  if (orderStatus === 80) return [{ type: 7, name: '删除订单' }];
  return [];
}

export function normalizeOrder(order = {}) {
  const orderStatus = statusOf(order.orderStatus ?? order.status);
  const items = (order.orderItemVOs || order.items || order.goodsList || []).map(normalizeItem);
  return {
    ...order,
    orderId: order.orderId ?? order.id ?? order._id,
    orderNo: order.orderNo || order.orderNumber,
    orderStatus,
    orderStatusName: order.orderStatusName || order.statusDesc || STATUS_LABELS[orderStatus] || '',
    paymentAmount: order.paymentAmount ?? order.amount ?? order.totalPayAmount ?? order.totalAmount ?? 0,
    totalAmount: order.totalAmount ?? order.goodsAmount ?? order.goodsAmountApp ?? 0,
    freightFee: order.freightFee ?? order.deliveryFee ?? 0,
    goodsAmountApp: order.goodsAmountApp ?? order.subtotal ?? order.totalAmount ?? 0,
    createTime: order.createTime || order.createdAt,
    orderItemVOs: items,
    buttonVOs: Array.isArray(order.buttonVOs) && order.buttonVOs.length ? order.buttonVOs : (Array.isArray(order.buttons) && order.buttons.length ? order.buttons : buttonsForStatus(orderStatus)),
    logisticsVO: { ...(order.logisticsVO || order.logistics || {}) },
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
  return callShop('orders.list', payload).then((response) => {
    const data = dataOf(response) || {};
    const orders = data.orders || data.list || data.items || [];
    const responsePage = Number(data.page ?? data.pageNum) || paging.page;
    return {
      data: {
        ...data,
        orders: Array.isArray(orders) ? orders.map(normalizeOrder) : [],
        page: responsePage,
        pageNum: responsePage,
        pageSize: Number(data.pageSize) || paging.pageSize,
        totalCount: Number(data.totalCount ?? data.total) || 0,
      },
    };
  });
}

export function fetchOrdersCount(params = {}) {
  return callShop('orders.count', params).then((response) => {
    const data = dataOf(response);
    const counts = Array.isArray(data) ? data : data?.items || data?.counts || data?.tabs || data?.list || [];
    return { data: Array.isArray(counts) ? counts.map((item) => ({ ...item, tabType: statusOf(item.tabType ?? item.status ?? item.orderStatus), orderNum: Number(item.orderNum ?? item.count ?? item.total) || 0 })) : [] };
  });
}
