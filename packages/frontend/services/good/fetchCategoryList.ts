// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const getCategoryList = (...args) => loadApi().then(api => api.categories.getCategoryList(...args));
