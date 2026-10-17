// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const getSearchResult = (...args) => loadApi().then(api => api.search.getSearchResult(...args));
