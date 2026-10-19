// @ts-nocheck

import { request, normalizeCommentList, resolveCommentImages } from './api';

export function fetchOrderComment(orderNo, productId = '') {
  return request('comments.list', {
    orderId: orderNo,
    ...(productId ? { productId } : {}),
    mineOnly: true,
    page: 1,
    pageSize: 1,
  }).then((result) => {
    return resolveCommentImages(normalizeCommentList(result).pageList[0] || null);
  });
}
// @ts-nocheck
