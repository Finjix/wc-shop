// Service implementation: services/good/fetchCategoryList.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const getCategoryList = (...args) => loadServices().then(api => api.categories.getCategoryList(...args));
