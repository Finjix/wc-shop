// @ts-nocheck

import { request } from '../../../utils/api';
import { normalizeSearchResult, toProductListPayload } from '../../../services/good/normalize';
import { resolveGoodsListImages } from '../../../services/good/resolveImages';

export async function getSearchResult(params = {}) {
  const result = normalizeSearchResult(await request('products.list', toProductListPayload(params)));
  return { ...result, spuList: await resolveGoodsListImages(result.spuList) };
}
// @ts-nocheck
