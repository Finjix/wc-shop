// Service implementation: services/order/services/orderDetail.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../../../common/services/client';
export const fetchOrderDetail = (...args) => loadServices().then(api => api.orderDetail.fetchOrderDetail(...args));
export const fetchBusinessTime = (...args) => loadServices().then(api => api.orderDetail.fetchBusinessTime(...args));
export const confirmOrderReceived = (...args) => loadServices().then(api => api.orderDetail.confirmOrderReceived(...args));
