// Service implementation: services/order/orderConfirm.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const setPendingGoodsRequestList = (...args) => loadServices().then(api => api.checkout.setPendingGoodsRequestList(...args));
export const getPendingGoodsRequestList = (...args) => loadServices().then(api => api.checkout.getPendingGoodsRequestList(...args));
export const clearPendingGoodsRequestList = (...args) => loadServices().then(api => api.checkout.clearPendingGoodsRequestList(...args));
export const fetchSettleDetail = (...args) => loadServices().then(api => api.checkout.fetchSettleDetail(...args));
export const fetchCheckoutResult = (...args) => loadServices().then(api => api.checkout.fetchCheckoutResult(...args));
export const createOrder = (...args) => loadServices().then(api => api.checkout.createOrder(...args));
export const payCheckout = (...args) => loadServices().then(api => api.checkout.payCheckout(...args));
