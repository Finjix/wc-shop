// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const normalizeGoodsItem = (...args) => loadApi().then(api => api.productAdapter.normalizeGoodsItem(...args));
export const getGoodsItems = (...args) => loadApi().then(api => api.productAdapter.getGoodsItems(...args));
export const normalizeGoodsList = (...args) => loadApi().then(api => api.productAdapter.normalizeGoodsList(...args));
export const normalizeSearchResult = (...args) => loadApi().then(api => api.productAdapter.normalizeSearchResult(...args));
export const normalizeCategoryList = (...args) => loadApi().then(api => api.productAdapter.normalizeCategoryList(...args));
export const normalizeHomeContent = (...args) => loadApi().then(api => api.productAdapter.normalizeHomeContent(...args));
export const toProductListPayload = (...args) => loadApi().then(api => api.productAdapter.toProductListPayload(...args));
