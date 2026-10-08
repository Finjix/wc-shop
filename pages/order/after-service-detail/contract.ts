// @ts-nocheck

// 当前云端状态到组件数字状态的转换；数字值用于已转换的组件模型。
const STATUS_CODES = { pending_review: 100, approved: 110, refunding: 130, refunded: 160, rejected: 170, withdrawn: 170 };
const DISPLAY_STATUS_CODES = new Set([100, 110, 120, 130, 140, 150, 160, 170]);

export function normalizeServiceType(value, fallback = null) { return [10, 20].includes(Number(value)) ? Number(value) : fallback; }
export function normalizeServiceStatus(value, fallback = null) {
  return DISPLAY_STATUS_CODES.has(value) ? value : STATUS_CODES[value] ?? fallback;
}
export function serviceStatusLabel(value, serviceType) {
  if (value === 'rejected') return '申请已驳回';
  if (value === 'withdrawn') return '已撤销';
  const status = normalizeServiceStatus(value);
  if (status === 100) return '等待商家审核';
  if (status === 110) return Number(serviceType) === 10 ? '审核通过，请填写退货物流' : '退款处理中';
  if (status === 120) return '等待填写退货物流';
  if (status === 130) return '退货运输中';
  if (status === 140) return '商家确认退货';
  if (status === 150) return '退货异常，请联系商家';
  if (status === 160) return '退款完成';
  if (status === 170) return '已关闭';
  return '处理中';
}
export function normalizeServiceButtons(value, serviceType, buttons = [], logisticsNo = '') {
  if (buttons.length) return buttons;
  const status = normalizeServiceStatus(value);
  if (status === 100) return [{ type: 2, name: '撤销申请' }];
  if (status === 110 && Number(serviceType) === 10) return [{ type: 3, name: '填写退货物流' }];
  if (status === 130 && logisticsNo) return [{ type: 5, name: '查看退货物流' }];
  return [];
}

// 此方法也处理已转换的申请商品模型，其 goodsName/specInfo 是当前页面字段。
export function normalizeOrderItem(item = {}) {
  const product = item.productSnapshot || {};
  const sku = item.skuSnapshot || {};
  return {
    ...item,
    productId: item.productId,
    spuId: item.productId,
    skuId: item.skuId,
    goodsName: item.goodsName || product.title || '',
    goodsPictureUrl: item.goodsPictureUrl || sku.skuImage || product.primaryImage || '',
    specInfo: item.specInfo || sku.specInfo || [],
    itemRefundAmount: item.amount,
    orderItemId: item.orderItemId || '',
  };
}
export function normalizeLogistics(source = {}) {
  return { ...source, logisticsNo: source.trackingNo || '', logisticsCompanyName: source.logisticsCompanyName || '', logisticsCompanyCode: source.logisticsCompanyCode || '', remark: source.remark || '' };
}
export function normalizeDeliveryCompany(company) {
  return company && typeof company === 'object' && company.name ? { name: company.name, code: company.code } : null;
}
export function normalizeDeliveryCompanyList(value) { return value.map(normalizeDeliveryCompany).filter(Boolean); }
export function extractDeliveryCompanyList(value) { return normalizeDeliveryCompanyList(value.deliveryCompanyList || []); }
