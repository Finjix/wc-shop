// @ts-nocheck

import { request, normalizeCommentList, resolveCommentListImages } from './api';

/** 获取商品评论 */
export function fetchComments(params = {}) {
  const query = params.queryParameter && typeof params.queryParameter === 'object' ? params.queryParameter : {};
  const payload = {
    productId: query.spuId || params.spuId,
    hasImage: query.hasImage,
    commentLevel: query.commentLevel,
    page: Number(params.pageNum) || 1,
    pageSize: params.pageSize || 20,
  };
  return request('comments.list', payload).then((result) =>
    resolveCommentListImages(normalizeCommentList(result)),
  );
}
// @ts-nocheck
