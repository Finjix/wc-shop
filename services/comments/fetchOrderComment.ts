// @ts-nocheck

import { request, normalizeComment, normalizeCommentList } from './api';

export function fetchOrderComment(orderNo, productId = '') {
  return request('comments.list', {
    orderNo,
    orderId: orderNo,
    ...(productId ? { productId, spuId: productId } : {}),
    mineOnly: true,
    pageNum: 1,
    page: 1,
    pageSize: 1,
  }).then((result) => {
    const data = result && result.data !== undefined ? result.data : result;
    const directComment = data && (data.comment || data.item);
    if (directComment) return normalizeComment(directComment);
    return normalizeCommentList(result, { pageNum: 1, pageSize: 1 }).pageList[0] || null;
  });
}
// @ts-nocheck
