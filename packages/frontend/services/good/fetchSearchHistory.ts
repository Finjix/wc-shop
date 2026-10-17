// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const getSearchHistory = (...args) => loadApi().then(api => api.searchHistory.getSearchHistory(...args));
export const addSearchHistory = (...args) => loadApi().then(api => api.searchHistory.addSearchHistory(...args));
export const deleteSearchHistory = (...args) => loadApi().then(api => api.searchHistory.deleteSearchHistory(...args));
export const clearSearchHistory = (...args) => loadApi().then(api => api.searchHistory.clearSearchHistory(...args));
