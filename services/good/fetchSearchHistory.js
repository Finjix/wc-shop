import { callShop } from '../../utils/cloud';

export function getSearchHistory() {
  return callShop('searchHistory.list');
}
export function addSearchHistory(keyword) {
  return callShop('searchHistory.add', { keyword });
}
export function deleteSearchHistory(keyword) {
  return callShop('searchHistory.remove', { keyword });
}
export function clearSearchHistory() {
  return callShop('searchHistory.clear');
}
