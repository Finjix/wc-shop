// @ts-nocheck

import { request } from '../utils/api';
import { normalizeSearchResult, toProductListPayload } from './normalize';
import { resolveGoodsListImages } from './resolveImages';

export async function fetchGoodsList(params = {}, imageOptions = {}) {
  const result = normalizeSearchResult(await request('products.list', toProductListPayload(params)));
  return { ...result, spuList: await resolveGoodsListImages(result.spuList, imageOptions) };
}
// @ts-nocheck
