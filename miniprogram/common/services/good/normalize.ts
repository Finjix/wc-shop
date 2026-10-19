// Service implementation: services/good/normalize.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const normalizeGoodsItem = (...args) => loadServices().then(api => api.productAdapter.normalizeGoodsItem(...args));
export const getGoodsItems = (...args) => loadServices().then(api => api.productAdapter.getGoodsItems(...args));
export const normalizeGoodsList = (...args) => loadServices().then(api => api.productAdapter.normalizeGoodsList(...args));
export const normalizeSearchResult = (...args) => loadServices().then(api => api.productAdapter.normalizeSearchResult(...args));
export const normalizeCategoryList = (...args) => loadServices().then(api => api.productAdapter.normalizeCategoryList(...args));
export const normalizeHomeContent = (...args) => loadServices().then(api => api.productAdapter.normalizeHomeContent(...args));
export const toProductListPayload = (...args) => loadServices().then(api => api.productAdapter.toProductListPayload(...args));
