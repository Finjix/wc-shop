// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const fetchGoodsList = (...args) => loadApi().then(api => api.products.fetchGoodsList(...args));
export const fetchAllGoodsList = (...args) => loadApi().then(api => api.products.fetchAllGoodsList(...args));
