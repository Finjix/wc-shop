import { callShop } from '../../utils/cloud';

export function fetchGood(ID = '') {
  return callShop('products.detail', { spuId: ID }).then((result) => {
    const details = result && result.product ? { ...result.product, skuList: result.skus || [] } : result;
    if (!details || typeof details !== 'object') {
      const error = new Error('商品不存在或已下架');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }
    return {
      ...details,
      spuId: details.spuId || details._id || ID,
      images: Array.isArray(details.images) ? details.images : (details.primaryImage ? [details.primaryImage] : []),
      desc: Array.isArray(details.desc) ? details.desc : [],
      specList: Array.isArray(details.specList) ? details.specList : [],
      skuList: Array.isArray(details.skuList) ? details.skuList : [],
    };
  });
}
