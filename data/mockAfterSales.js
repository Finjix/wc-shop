import { getMockOrder } from './mockOrders';

const AFTER_SALE_STATUS = {
  PENDING_REVIEW: 100,
  APPROVED: 110,
  PENDING_RECEIPT: 130,
  REFUNDED: 160,
  CLOSED: 170,
};

const STATUS_NAMES = {
  [AFTER_SALE_STATUS.PENDING_REVIEW]: {
    name: '待审核',
    desc: '您的售后申请已提交，请等待商家审核',
  },
  [AFTER_SALE_STATUS.APPROVED]: {
    name: '已审核',
    desc: '售后申请已审核通过',
  },
  [AFTER_SALE_STATUS.PENDING_RECEIPT]: {
    name: '退款中',
    desc: '退款正在处理中',
  },
  [AFTER_SALE_STATUS.REFUNDED]: {
    name: '已完成',
    desc: '退款已完成',
  },
  [AFTER_SALE_STATUS.CLOSED]: {
    name: '已关闭',
    desc: '售后申请已关闭',
  },
};

const MOCK_REASONS = [
  { id: 'mock-reason-1', desc: '商品质量问题' },
  { id: 'mock-reason-2', desc: '商品与描述不符' },
  { id: 'mock-reason-3', desc: '不想要了' },
  { id: 'mock-reason-4', desc: '其他原因' },
];

let afterSaleSequence = 1;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function findOrder(params = {}) {
  return getMockOrder(params.orderNo || params.orderId || params.orderNumber);
}

function findOrderItems(order, params = {}) {
  const items = order?.orderItemVOs || [];
  const skuId = params.skuId || params.sku;
  const spuId = params.spuId || params.productId;
  if (!skuId && !spuId) return items;
  return items.filter((item) => (
    (!skuId || String(item.skuId) === String(skuId)) &&
    (!spuId || String(item.spuId) === String(spuId))
  ));
}

function toRightsItem(item, overrides = {}) {
  const quantity = Number(overrides.rightsQuantity ?? overrides.quantity ?? item.buyQuantity) || 1;
  const amount = Number(overrides.itemTotalAmount ?? overrides.itemRefundAmount ?? item.itemPaymentAmount) || 0;
  const specifications = item.specifications || [];
  return {
    id: item.id,
    orderItemId: item.id,
    itemId: item.id,
    productId: item.spuId,
    spuId: item.spuId,
    skuId: item.skuId,
    goodsPictureUrl: item.goodsPictureUrl,
    goodsName: item.goodsName,
    title: item.goodsName,
    specifications,
    specInfo: specifications,
    paidAmountEach: item.actualPrice,
    actualPrice: item.actualPrice,
    itemPaymentAmount: item.itemPaymentAmount,
    itemRefundAmount: amount,
    refundAmount: amount,
    boughtQuantity: item.buyQuantity,
    quantity: item.buyQuantity,
    rightsQuantity: quantity,
  };
}

export function getMockAfterSalePreview(params = {}) {
  const order = findOrder(params);
  const items = findOrderItems(order, params);
  const goodsList = items.map((item) => ({
    ...toRightsItem(item),
    numOfSku: item.buyQuantity,
    numOfSkuAvailable: item.buyQuantity,
    refundableAmount: item.itemPaymentAmount,
    goodsInfo: {
      goodsName: item.goodsName,
      skuImage: item.goodsPictureUrl,
      specInfo: item.specifications || [],
    },
  }));
  const refundableAmount = goodsList.reduce((sum, item) => sum + Number(item.refundableAmount || 0), 0);
  const numOfSku = goodsList.reduce((sum, item) => sum + Number(item.boughtQuantity || 0), 0);
  return {
    orderNo: order?.orderNo || params.orderNo || '',
    refundableAmount,
    numOfSku,
    numOfSkuAvailable: numOfSku,
    goodsList,
  };
}

function buildAfterSaleRecord(params = {}, seed = false) {
  const rights = params.rights || {};
  const order = findOrder({ orderNo: rights.orderNo || params.orderNo });
  const orderItems = order?.orderItemVOs || [];
  const submittedItems = Array.isArray(params.rightsItem) ? params.rightsItem : [];
  const rightsItem = (submittedItems.length ? submittedItems : orderItems).map((submitted) => {
    const source = orderItems.find((item) => (
      String(item.id) === String(submitted.orderItemId || submitted.itemId) ||
      String(item.skuId) === String(submitted.skuId)
    )) || submitted;
    return toRightsItem(source, submitted);
  });
  const fallbackAmount = rightsItem.reduce((sum, item) => sum + Number(item.itemRefundAmount || 0), 0);
  const refundAmount = Number(rights.refundRequestAmount ?? params.refundAmount ?? fallbackAmount) || 0;
  const reason = rights.rightsReasonDesc || rights.reason || params.refundMemo || params.description || '';
  const status = AFTER_SALE_STATUS.PENDING_REVIEW;
  const statusText = STATUS_NAMES[status];
  const rightsNo = seed
    ? 'MOCK-RIGHTS-1001'
    : `MOCK-RIGHTS-${Date.now()}-${afterSaleSequence++}`;
  const images = params.images || rights.rightsImageUrls || [];
  return {
    rightsNo,
    afterSaleId: rightsNo,
    id: rightsNo,
    orderNo: order?.orderNo || rights.orderNo || params.orderNo || '',
    orderId: order?.orderId || rights.orderId || rights.orderNo || params.orderNo || '',
    storeId: order?.storeId || '',
    storeName: order?.storeName || '云mall标准版旗舰店',
    rightsType: Number(rights.rightsType ?? rights.type) || 20,
    type: Number(rights.type ?? rights.rightsType) || 20,
    afterSaleRequireType: 'REFUND_MONEY',
    rightsStatus: status,
    userRightsStatus: status,
    status,
    userRightsStatusName: statusText.name,
    userRightsStatusDesc: statusText.desc,
    statusName: statusText.name,
    statusDesc: statusText.desc,
    refundAmount,
    refundRequestAmount: refundAmount,
    rightsReasonDesc: reason,
    reason,
    description: reason,
    refundMemo: reason,
    receiptStatus: rights.receiptStatus ?? 1,
    rightsImageUrls: images,
    images,
    createTime: seed ? 1750000000000 : Date.now(),
    rightsItem,
    buttonVOs: [],
    refundMethodList: [],
    rightsRefund: {
      refundDesc: reason,
    },
    logisticsVO: {},
    deliveryCompanyList: [
      { name: '顺丰速运', code: 'SF' },
      { name: '中通快递', code: 'ZTO' },
      { name: '圆通速递', code: 'YTO' },
    ],
  };
}

const seedOrder = getMockOrder('MOCK202506160003');
export const mockAfterSales = seedOrder ? [buildAfterSaleRecord({
  orderNo: seedOrder.orderNo,
  rights: {
    orderNo: seedOrder.orderNo,
    type: 20,
    rightsType: 20,
    refundRequestAmount: seedOrder.paymentAmount,
    rightsReasonDesc: '商品与描述不符',
    receiptStatus: 1,
  },
  rightsItem: (seedOrder.orderItemVOs || []).map((item) => ({
    orderItemId: item.id,
    skuId: item.skuId,
    spuId: item.spuId,
    itemTotalAmount: item.itemPaymentAmount,
    rightsQuantity: item.buyQuantity,
  })),
}, true)] : [];

export function getMockAfterSaleReasons() {
  return clone(MOCK_REASONS);
}

export function createMockAfterSale(params = {}) {
  const order = findOrder({ orderNo: params.rights?.orderNo || params.orderNo });
  if (!order) return null;
  const record = buildAfterSaleRecord(params);
  mockAfterSales.unshift(record);
  return clone(record);
}

export function listMockAfterSales(params = {}) {
  const status = String(params.status || '').toLowerCase();
  const statusMap = {
    pending_review: AFTER_SALE_STATUS.PENDING_REVIEW,
    approved: AFTER_SALE_STATUS.APPROVED,
    refunding: AFTER_SALE_STATUS.PENDING_RECEIPT,
    refunded: AFTER_SALE_STATUS.REFUNDED,
    rejected: AFTER_SALE_STATUS.CLOSED,
  };
  const filtered = status && statusMap[status]
    ? mockAfterSales.filter((item) => item.rightsStatus === statusMap[status])
    : mockAfterSales;
  const page = Math.max(1, Number(params.page || params.pageNum) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || 10);
  const start = (page - 1) * pageSize;
  const count = (statusCode) => mockAfterSales.filter((item) => item.rightsStatus === statusCode).length;
  return {
    page,
    pageNum: page,
    pageSize,
    totalCount: filtered.length,
    dataList: clone(filtered.slice(start, start + pageSize)),
    states: {
      audit: count(AFTER_SALE_STATUS.PENDING_REVIEW),
      approved: count(AFTER_SALE_STATUS.APPROVED),
      complete: count(AFTER_SALE_STATUS.REFUNDED),
      closed: count(AFTER_SALE_STATUS.CLOSED),
    },
  };
}

export function getMockAfterSale(rightsNo) {
  return clone(mockAfterSales.find((item) => (
    String(item.rightsNo) === String(rightsNo) ||
    String(item.afterSaleId) === String(rightsNo) ||
    String(item.id) === String(rightsNo)
  )));
}

export function confirmMockAfterSaleReceived() {
  return { success: true };
}

export function submitMockAfterSaleTracking(params = {}) {
  const rightsNo = params.rightsNo || params.afterSaleId;
  const record = mockAfterSales.find((item) => String(item.rightsNo) === String(rightsNo));
  if (!record) return null;
  const logisticsNo = params.logisticsNo || params.trackingNo || '';
  record.logisticsVO = {
    ...(record.logisticsVO || {}),
    logisticsNo,
    trackingNo: logisticsNo,
    logisticsCompanyCode: params.logisticsCompanyCode || params.companyCode || '',
    logisticsCompanyName: params.logisticsCompanyName || params.companyName || '',
  };
  record.logistics = record.logisticsVO;
  record.rightsStatus = AFTER_SALE_STATUS.PENDING_RECEIPT;
  record.userRightsStatus = AFTER_SALE_STATUS.PENDING_RECEIPT;
  record.status = AFTER_SALE_STATUS.PENDING_RECEIPT;
  record.userRightsStatusName = '退款中';
  record.userRightsStatusDesc = '退回商品后等待商家收货';
  record.statusName = record.userRightsStatusName;
  record.statusDesc = record.userRightsStatusDesc;
  return clone(record);
}
