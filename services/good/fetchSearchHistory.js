import { request } from '../../utils/api';

export function getSearchHistory() {
  return request('searchHistory.list');
}
export function addSearchHistory(keyword) {
  return request('searchHistory.add', { keyword });
}
export function deleteSearchHistory(keyword) {
  return request('searchHistory.remove', { keyword });
}
export function clearSearchHistory() {
  return request('searchHistory.clear');
}
