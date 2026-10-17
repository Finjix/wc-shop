// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const getGoodsDetailsCommentsCount = (...args) => loadApi().then(api => api.goodsComments.getGoodsDetailsCommentsCount(...args));
export const getGoodsDetailsCommentList = (...args) => loadApi().then(api => api.goodsComments.getGoodsDetailsCommentList(...args));
