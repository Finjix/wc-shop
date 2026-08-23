import { callShop } from '../../utils/cloud';
import { normalizeSearchResult, toProductListPayload } from './normalize';

export function fetchGoodsList(params = {}) {
  return callShop('products.list', toProductListPayload(params)).then(normalizeSearchResult);
}
