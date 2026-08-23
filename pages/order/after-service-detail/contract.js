const SERVICE_TYPE_ALIASES = {
  '10': 10,
  return: 10,
  return_goods: 10,
  'return-goods': 10,
  returngoods: 10,
  refund_goods: 10,
  refund_goods_money: 10,
  '20': 20,
  refund: 20,
  only_refund: 20,
  'only-refund': 20,
  onlyrefund: 20,
  refund_money: 20,
  '30': 30,
  order_cancel: 30,
  'order-cancel': 30,
  ordercancel: 30,
};

const SERVICE_STATUS_ALIASES = {
  '100': 100,
  pending: 100,
  pending_review: 100,
  'pending-review': 100,
  pendingreview: 100,
  refund_requested: 100,
  refundrequested: 100,
  '110': 110,
  approved: 110,
  verified: 110,
  pending_delivery: 120,
  'pending-delivery': 120,
  pendingdelivery: 120,
  '120': 120,
  pending_receipt: 130,
  'pending-receipt': 130,
  pendingreceipt: 130,
  refunding: 130,
  '130': 130,
  received: 140,
  '140': 140,
  exception: 150,
  abnormal: 150,
  '150': 150,
  refunded: 160,
  refund_success: 160,
  refundsuccess: 160,
  '160': 160,
  rejected: 170,
  closed: 170,
  cancelled: 170,
  canceled: 170,
  '170': 170,
};

function normalizedKey(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '_');
}

export function normalizeServiceType(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return SERVICE_TYPE_ALIASES[String(value)] ?? fallback;
  }
  return SERVICE_TYPE_ALIASES[normalizedKey(value)] ?? fallback;
}

export function normalizeServiceStatus(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return SERVICE_STATUS_ALIASES[String(value)] ?? value;
  }
  return SERVICE_STATUS_ALIASES[normalizedKey(value)] ?? fallback;
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return '';
}

export function normalizeOrderItem(item = {}) {
  const productSnapshot = item.productSnapshot || item.product || {};
  const skuSnapshot = item.skuSnapshot || item.sku || {};
  const productId = firstValue(item, ['productId', 'spuId', 'product_id'])
    || firstValue(productSnapshot, ['spuId', 'productId', '_id']);
  const skuId = firstValue(item, ['skuId', 'sku_id'])
    || firstValue(skuSnapshot, ['skuId', '_id']);
  return {
    ...item,
    productId,
    spuId: firstValue(item, ['spuId', 'productId']) || productId,
    skuId,
    orderItemId: firstValue(item, ['orderItemId', 'itemId', '_id']),
  };
}

export function normalizeLogistics(logistics = {}) {
  const source = logistics || {};
  return {
    ...source,
    logisticsNo: firstValue(source, ['logisticsNo', 'trackingNo', 'trackingNumber', 'waybillNo']),
    logisticsCompanyName: firstValue(source, ['logisticsCompanyName', 'companyName', 'deliveryCompanyName']),
    logisticsCompanyCode: firstValue(source, ['logisticsCompanyCode', 'companyCode', 'deliveryCompanyCode']),
    remark: firstValue(source, ['remark', 'description', 'logisticsDescription']),
  };
}

export function normalizeDeliveryCompany(company) {
  if (typeof company === 'string') {
    const name = company.trim();
    return name ? { name, code: name } : null;
  }
  if (!company || typeof company !== 'object') return null;
  const name = firstValue(company, ['name', 'companyName', 'logisticsCompanyName', 'deliveryCompanyName', 'title']);
  const code = firstValue(company, ['code', 'companyCode', 'logisticsCompanyCode', 'deliveryCompanyCode', 'value', 'key', 'id']) || name;
  return name ? { ...company, name, code } : null;
}

const DELIVERY_COMPANY_KEYS = [
  'deliveryCompanyList',
  'deliveryCompanies',
  'logisticsCompanyList',
  'logisticsCompanies',
  'companyList',
  'companies',
];

export function normalizeDeliveryCompanyList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeDeliveryCompany).filter(Boolean);
  }
  if (!value || typeof value !== 'object') return [];
  for (const key of DELIVERY_COMPANY_KEYS) {
    if (Array.isArray(value[key])) return normalizeDeliveryCompanyList(value[key]);
  }
  if (value.data !== undefined && value.data !== value) return normalizeDeliveryCompanyList(value.data);
  if (value.result !== undefined && value.result !== value) return normalizeDeliveryCompanyList(value.result);
  return [];
}

export function extractDeliveryCompanyList(value) {
  const direct = normalizeDeliveryCompanyList(value);
  if (direct.length) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return direct;
  const nestedKeys = ['data', 'result', 'detail', 'item', 'record'];
  for (const key of nestedKeys) {
    if (value[key] !== undefined) {
      const nested = extractDeliveryCompanyList(value[key]);
      if (nested.length) return nested;
    }
  }
  return direct;
}
