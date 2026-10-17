// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeCategoryList } from './normalize';
import { resolveCategoryListImages } from './resolveImages';

export async function getCategoryList() {
  return resolveCategoryListImages(normalizeCategoryList(await request('categories.list')));
}
// @ts-nocheck
