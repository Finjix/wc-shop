import { callShop } from '../../utils/cloud';
import { normalizeGoodsList } from './normalize';

export function fetchGoodsList(pageIndex = 1, pageSize = 20) {
  return callShop('products.list', { page: Math.max(1, Number(pageIndex) || 1), pageSize })
    .then(normalizeGoodsList);
}
