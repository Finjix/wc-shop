import { callShop, getCloudErrorMessage } from '../../utils/cloud';

function resourceId(resource) {
  if (!resource) return '';
  if (typeof resource === 'string') return resource;
  return resource.image || resource.fileID || resource.fileId || resource.url || resource.src || '';
}

const COMMENT_STATUS_ALIASES = {
  '0': 'pending_review',
  '1': 'active',
  active: 'active',
  approved: 'active',
  passed: 'active',
  pending: 'pending_review',
  pending_review: 'pending_review',
  'pending-review': 'pending_review',
  reviewing: 'pending_review',
  rejected: 'rejected',
  closed: 'rejected',
  inactive: 'rejected',
};

function firstValue(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return '';
}

export function normalizeCommentStatus(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') {
    if (value === 1) return 'active';
    if (value === 0) return 'pending_review';
  }
  const key = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  return COMMENT_STATUS_ALIASES[key] || fallback || key;
}

export function normalizeCommentResources(resources) {
  return (Array.isArray(resources) ? resources : [])
    .filter((resource) => !resource || !resource.type || resource.type === 'image')
    .map((resource) => resourceId(resource))
    .filter(Boolean)
    .map((fileID) => ({ type: 'image', image: fileID, fileID }));
}

export function normalizeComment(comment) {
  if (!comment || typeof comment !== 'object') return null;
  const productSnapshot = comment.productSnapshot || comment.product || {};
  const skuSnapshot = comment.skuSnapshot || comment.sku || {};
  const orderId = firstValue(comment, ['orderId', 'orderNo', 'orderNumber']);
  const productId = firstValue(comment, ['productId', 'spuId', 'product_id'])
    || firstValue(productSnapshot, ['spuId', 'productId', '_id']);
  const skuId = firstValue(comment, ['skuId', 'sku_id'])
    || firstValue(skuSnapshot, ['skuId', '_id']);
  const status = normalizeCommentStatus(comment.status ?? comment.commentStatus);
  return {
    ...comment,
    orderId,
    orderNo: firstValue(comment, ['orderNo', 'orderId', 'orderNumber']) || orderId,
    productId,
    spuId: firstValue(comment, ['spuId', 'productId']) || productId,
    skuId,
    orderItemId: firstValue(comment, ['orderItemId', 'itemId']),
    ...(status ? { status, commentStatus: status } : {}),
    commentContent: comment.commentContent || comment.content || '',
    commentScore: comment.commentScore ?? comment.rating ?? 0,
    commentTime: comment.commentTime || comment.createdAt || comment.createTime,
    commentResources: normalizeCommentResources(
      comment.commentResources || comment.resources || comment.commentImageUrls,
    ),
  };
}

export function normalizeCommentList(result, fallbackPage = {}) {
  const resultData = result && result.data !== undefined ? result.data : result;
  const data = resultData && resultData.data && !Array.isArray(resultData.data)
    ? resultData.data
    : resultData || {};
  const pageList = Array.isArray(data)
    ? data
    : data.pageList || data.list || data.items || data.records || [];
  const normalizedList = Array.isArray(pageList)
    ? pageList.map(normalizeComment).filter(Boolean)
    : [];
  return {
    ...(Array.isArray(data) ? {} : data),
    page: data.page ?? data.pageNum ?? fallbackPage.page ?? fallbackPage.pageNum ?? 1,
    pageNum: data.pageNum ?? data.page ?? fallbackPage.pageNum ?? fallbackPage.page ?? 1,
    pageSize: data.pageSize ?? fallbackPage.pageSize ?? normalizedList.length,
    totalCount: Number(data.totalCount ?? data.total ?? normalizedList.length),
    pageList: normalizedList,
  };
}

export function normalizeCommentPayload(payload = {}) {
  const orderId = firstValue(payload, ['orderId', 'orderNo', 'orderNumber']);
  const productId = firstValue(payload, ['productId', 'spuId', 'product_id']);
  const skuId = firstValue(payload, ['skuId', 'sku_id']);
  const orderItemId = firstValue(payload, ['orderItemId', 'itemId']);
  const commentResources = normalizeCommentResources(payload.commentResources || payload.resources);
  return {
    ...payload,
    orderId,
    orderNo: firstValue(payload, ['orderNo', 'orderId', 'orderNumber']) || orderId,
    productId,
    spuId: firstValue(payload, ['spuId', 'productId']) || productId,
    ...(skuId ? { skuId } : {}),
    ...(orderItemId ? { orderItemId } : {}),
    content: payload.content || payload.commentContent || '',
    rating: payload.rating ?? payload.commentScore,
    images: commentResources
      .map((resource) => resource.fileID || resource.image),
    commentResources,
  };
}

export { callShop, getCloudErrorMessage };
