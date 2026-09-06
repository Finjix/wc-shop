import { request } from '../../utils/api';
import { normalizeGoodsList } from './normalize';

export function fetchGoodsList(pageIndex = 1, pageSize = 20) {
  return request('products.list', { page: Math.max(1, Number(pageIndex) || 1), pageSize })
    .then(normalizeGoodsList);
}
