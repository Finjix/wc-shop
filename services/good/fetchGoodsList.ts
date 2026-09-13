// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeSearchResult, toProductListPayload } from './normalize';

export function fetchGoodsList(params = {}) {
  return request('products.list', toProductListPayload(params)).then(normalizeSearchResult);
}
// @ts-nocheck
