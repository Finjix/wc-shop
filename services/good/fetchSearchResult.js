import { callShop } from '../../utils/cloud';
import { normalizeSearchResult, toProductListPayload } from './normalize';

export function getSearchResult(params = {}) {
  return callShop('products.list', toProductListPayload(params)).then(normalizeSearchResult);
}
