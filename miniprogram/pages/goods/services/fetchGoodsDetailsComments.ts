// Service implementation: services/goods/services/fetchGoodsDetailsComments.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const getGoodsDetailsCommentsCount = (...args) => loadServices().then(api => api.goodsComments.getGoodsDetailsCommentsCount(...args));
export const getGoodsDetailsCommentList = (...args) => loadServices().then(api => api.goodsComments.getGoodsDetailsCommentList(...args));
