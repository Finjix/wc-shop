// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const fetchGoodsList = (...args) => loadApi().then(api => api.productList.fetchGoodsList(...args));
