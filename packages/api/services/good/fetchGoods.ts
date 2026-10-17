// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeGoodsList } from './normalize';
import { resolveGoodsListImages } from './resolveImages';

export function fetchGoodsList(pageIndex = 1, pageSize = 20) {
  return request('products.list', { page: Math.max(1, Number(pageIndex) || 1), pageSize })
    .then(normalizeGoodsList)
    .then(resolveGoodsListImages);
}

export async function fetchAllGoodsList() {
  const goods = new Map();
  for (let page = 1; ; page += 1) {
    const result = await request('products.list', { page, pageSize: 100 });
    const items = normalizeGoodsList(result);
    items.forEach((item) => goods.set(String(item.spuId), item));
    const pageSize = Number(result?.pageSize) || 100;
    if (!items.length || (Number.isFinite(Number(result?.total))
      ? page * pageSize >= Number(result.total) : items.length < pageSize)) break;
  }
  return Array.from(goods.values());
}
// @ts-nocheck
