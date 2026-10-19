// Service implementation: services/good/fetchGoodsList.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const fetchGoodsList = (...args) => loadServices().then(api => api.productList.fetchGoodsList(...args));
