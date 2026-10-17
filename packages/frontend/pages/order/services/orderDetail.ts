// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const fetchOrderDetail = (...args) => loadApi().then(api => api.orderDetail.fetchOrderDetail(...args));
export const fetchBusinessTime = (...args) => loadApi().then(api => api.orderDetail.fetchBusinessTime(...args));
export const confirmOrderReceived = (...args) => loadApi().then(api => api.orderDetail.confirmOrderReceived(...args));
