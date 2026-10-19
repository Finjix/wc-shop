// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeSearchResult, toProductListPayload } from '../../good/normalize';
import { resolveGoodsListImages } from '../../good/resolveImages';

export async function getSearchResult(params = {}) {
  const result = normalizeSearchResult(await request('products.list', toProductListPayload(params)));
  return { ...result, spuList: await resolveGoodsListImages(result.spuList) };
}
// @ts-nocheck
