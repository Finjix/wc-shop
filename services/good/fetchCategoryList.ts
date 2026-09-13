// @ts-nocheck

import { request } from '../../utils/api';
import { normalizeCategoryList } from './normalize';

export function getCategoryList() {
  return request('categories.list').then(normalizeCategoryList);
}
// @ts-nocheck
