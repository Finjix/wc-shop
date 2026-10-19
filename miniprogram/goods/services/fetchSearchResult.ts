// Service implementation: services/goods/services/fetchSearchResult.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../common/services/client';
export const getSearchResult = (...args) => loadServices().then(api => api.search.getSearchResult(...args));
