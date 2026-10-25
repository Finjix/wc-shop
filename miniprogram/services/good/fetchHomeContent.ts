// @ts-nocheck

import { request } from '../utils/api';
import { normalizeHomeContent, normalizeGoodsList } from './normalize';
import { resolveHomeContentImages, resolveGoodsListImages } from './resolveImages';

/** 获取首页运营配置；未配置的位置不显示。 */
export async function fetchHomeContent() {
  const result = await request('home.get', {});
  return normalizeHomeContent(await resolveHomeContentImages(result));
}

export async function fetchHomeFeed(params = {}) {
  const result = await request('home.feed', params);
  return { ...result, items: await resolveGoodsListImages(normalizeGoodsList(result)) };
}
// @ts-nocheck
