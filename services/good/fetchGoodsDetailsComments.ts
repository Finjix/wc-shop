// @ts-nocheck

import { request } from '../../utils/api';
import { fetchComments } from '../comments/fetchComments';

export function getGoodsDetailsCommentsCount(spuId = '') {
  return request('comments.count', { spuId }).then((result) => {
    const source = result || {};
    const commentCount = Number(source.commentCount ?? source.total ?? 0) || 0;
    const goodCount = Number(source.goodCount || 0);
    return {
      ...source,
      badCount: Number(source.badCount || 0),
      commentCount,
      goodCount,
      goodRate: commentCount ? Math.round((goodCount / commentCount) * 100) : 0,
      hasImageCount: Number(source.hasImageCount || 0),
      middleCount: Number(source.middleCount || 0),
    };
  });
}

export function getGoodsDetailsCommentList(spuId = '') {
  return fetchComments({ spuId }).then((result) => result.pageList);
}
// @ts-nocheck
