import { callShop } from '../../utils/cloud';
import { normalizeGoodsList, normalizeHomeContent } from './normalize';

/** 获取首页运营内容与真实商品，空库时返回空数组，不注入演示商品。 */
export function fetchHomeContent(pageSize = 36) {
  return Promise.all([
    callShop('home.get', {}),
    callShop('products.list', { page: 1, pageSize }),
  ]).then(([homeResult, productResult]) => {
    const products = normalizeGoodsList(productResult);
    const home = normalizeHomeContent(homeResult);
    return { ...home, goodsList: products.length ? products : home.goodsList, productItems: products };
  });
}
