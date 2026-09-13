// @ts-nocheck

import { request } from '../../utils/api';
import { resolveProductDetailImages } from './resolveImages';

export async function fetchGood(ID = '') {
  const result = await request('products.detail', { spuId: ID });
  const details = result && result.product ? { ...result.product, skuList: result.skus || [] } : result;
  if (!details || typeof details !== 'object') {
    const error = new Error('商品不存在或已下架');
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  const resolvedDetails = await resolveProductDetailImages(details);
  return {
    ...resolvedDetails,
    spuId: resolvedDetails.spuId || resolvedDetails._id || ID,
    desc: Array.isArray(resolvedDetails.desc) ? resolvedDetails.desc : [],
    specList: Array.isArray(resolvedDetails.specList) ? resolvedDetails.specList : [],
    skuList: Array.isArray(resolvedDetails.skuList) ? resolvedDetails.skuList : [],
  };
}
// @ts-nocheck
