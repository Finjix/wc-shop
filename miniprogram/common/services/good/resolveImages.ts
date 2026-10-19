// Service implementation: services/good/resolveImages.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const resolveGoodsListImages = (...args) => loadServices().then(api => api.productImages.resolveGoodsListImages(...args));
export const resolveCategoryListImages = (...args) => loadServices().then(api => api.productImages.resolveCategoryListImages(...args));
export const resolveProductDetailImages = (...args) => loadServices().then(api => api.productImages.resolveProductDetailImages(...args));
export const resolveHomeContentImages = (...args) => loadServices().then(api => api.productImages.resolveHomeContentImages(...args));
