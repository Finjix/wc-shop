import { callShop } from './api';

/** 获取商品评论数 */
export function fetchCommentsCount(params = {}) {
  const input = params && typeof params === 'object' ? params : { spuId: params };
  const productId = input.productId || input.spuId;
  const payload = productId ? { ...input, productId, spuId: input.spuId || productId } : input;
  return callShop('comments.count', payload).then((result) => {
    const data = result && result.data && !Array.isArray(result.data) ? result.data : result || {};
    return {
      ...data,
      commentCount: String(data.commentCount ?? data.totalCount ?? data.total ?? 0),
      badCount: String(data.badCount ?? 0),
      middleCount: String(data.middleCount ?? 0),
      goodCount: String(data.goodCount ?? 0),
      hasImageCount: String(data.hasImageCount ?? 0),
      uidCount: String(data.uidCount ?? 0),
    };
  });
}
