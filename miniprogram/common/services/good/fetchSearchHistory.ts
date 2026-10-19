// Service implementation: services/good/fetchSearchHistory.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const getSearchHistory = (...args) => loadServices().then(api => api.searchHistory.getSearchHistory(...args));
export const addSearchHistory = (...args) => loadServices().then(api => api.searchHistory.addSearchHistory(...args));
export const deleteSearchHistory = (...args) => loadServices().then(api => api.searchHistory.deleteSearchHistory(...args));
export const clearSearchHistory = (...args) => loadServices().then(api => api.searchHistory.clearSearchHistory(...args));
