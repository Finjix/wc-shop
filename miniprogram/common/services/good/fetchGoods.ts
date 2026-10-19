// Service implementation: services/good/fetchGoods.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const fetchGoodsList = (...args) => loadServices().then(api => api.products.fetchGoodsList(...args));
export const fetchAllGoodsList = (...args) => loadServices().then(api => api.products.fetchAllGoodsList(...args));
