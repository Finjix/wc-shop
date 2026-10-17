// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const normalizeRecord = (...args) => loadApi().then(api => api.afterSaleList.normalizeRecord(...args));
export const getRightsList = (...args) => loadApi().then(api => api.afterSaleList.getRightsList(...args));
