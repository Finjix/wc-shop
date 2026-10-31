// Service implementation: services/order/after-service-list/api.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const normalizeRecord = (...args) => loadServices().then(api => api.afterSaleList.normalizeRecord(...args));
export const getRightsList = (...args) => loadServices().then(api => api.afterSaleList.getRightsList(...args));
