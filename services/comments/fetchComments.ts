// @ts-nocheck

import { request, normalizeCommentList } from './api';

/** 获取商品评论 */
export function fetchComments(params = {}) {
  const query = params.queryParameter && typeof params.queryParameter === 'object' ? params.queryParameter : {};
  const payload = {
    ...params,
    ...query,
    pageNum: Number(params.pageNum ?? params.page ?? 1) || 1,
    page: Number(params.page ?? params.pageNum ?? 1) || 1,
    pageSize: params.pageSize || 20,
  };
  return request('comments.list', payload).then((result) =>
    normalizeCommentList(result, payload),
  );
}
// @ts-nocheck
