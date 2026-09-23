// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeHomeContent } from './normalize';
import { resolveHomeContentImages } from './resolveImages';

/** 获取首页运营配置；未配置的位置不显示。 */
export async function fetchHomeContent() {
  const result = await request('home.get', {}).catch(() => ({}));
  return normalizeHomeContent(await resolveHomeContentImages(result));
}
// @ts-nocheck
