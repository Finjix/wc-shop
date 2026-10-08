// @ts-nocheck

import { request } from './api';

/** 获取商品评论数 */
export function fetchCommentsCount(params = {}) {
  const payload = { productId: params.spuId };
  return request('comments.count', payload).then((result) => {
    const data = result;
    return {
      ...data,
      commentCount: String(data.commentCount),
      badCount: String(data.badCount ?? 0),
      middleCount: String(data.middleCount ?? 0),
      goodCount: String(data.goodCount ?? 0),
      hasImageCount: String(data.hasImageCount ?? 0),
      uidCount: String(data.uidCount ?? 0),
    };
  });
}
// @ts-nocheck
