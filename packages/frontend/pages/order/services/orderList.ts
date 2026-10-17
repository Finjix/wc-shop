// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const normalizeOrder = (...args) => loadApi().then(api => api.orderList.normalizeOrder(...args));
export const fetchOrders = (...args) => loadApi().then(api => api.orderList.fetchOrders(...args));
export const fetchOrdersCount = (...args) => loadApi().then(api => api.orderList.fetchOrdersCount(...args));
