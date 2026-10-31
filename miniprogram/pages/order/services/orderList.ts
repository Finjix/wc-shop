// Service implementation: services/order/services/orderList.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const normalizeOrder = (...args) => loadServices().then(api => api.orderList.normalizeOrder(...args));
export const fetchOrders = (...args) => loadServices().then(api => api.orderList.fetchOrders(...args));
export const fetchOrdersCount = (...args) => loadServices().then(api => api.orderList.fetchOrdersCount(...args));
