// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeGoodsList, normalizeHomeContent } from './normalize';
import { resolveGoodsListImages, resolveHomeContentImages } from './resolveImages';

/** 获取首页运营内容与真实商品，空库时返回空数组，不注入演示商品。 */
export async function fetchHomeContent(pageSize = 36) {
  const [homeResult, productResult] = await Promise.all([
    request('home.get', {}).catch(() => ({})),
    request('products.list', { page: 1, pageSize }),
  ]);
  const [products, homeResultWithImages] = await Promise.all([
    resolveGoodsListImages(normalizeGoodsList(productResult)),
    resolveHomeContentImages(homeResult),
  ]);
  const home = normalizeHomeContent(homeResultWithImages);
  return { ...home, goodsList: products.length ? products : home.goodsList, productItems: products };
}
// @ts-nocheck
