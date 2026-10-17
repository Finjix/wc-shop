// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const resolveGoodsListImages = (...args) => loadApi().then(api => api.productImages.resolveGoodsListImages(...args));
export const resolveCategoryListImages = (...args) => loadApi().then(api => api.productImages.resolveCategoryListImages(...args));
export const resolveProductDetailImages = (...args) => loadApi().then(api => api.productImages.resolveProductDetailImages(...args));
export const resolveHomeContentImages = (...args) => loadApi().then(api => api.productImages.resolveHomeContentImages(...args));
