import { callShop } from '../../utils/cloud';
import { normalizeCategoryList } from './normalize';

export function getCategoryList() {
  return callShop('categories.list').then(normalizeCategoryList);
}
