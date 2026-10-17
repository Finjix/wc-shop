// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const setPendingGoodsRequestList = (...args) => loadApi().then(api => api.checkout.setPendingGoodsRequestList(...args));
export const getPendingGoodsRequestList = (...args) => loadApi().then(api => api.checkout.getPendingGoodsRequestList(...args));
export const clearPendingGoodsRequestList = (...args) => loadApi().then(api => api.checkout.clearPendingGoodsRequestList(...args));
export const fetchSettleDetail = (...args) => loadApi().then(api => api.checkout.fetchSettleDetail(...args));
export const fetchCheckoutResult = (...args) => loadApi().then(api => api.checkout.fetchCheckoutResult(...args));
export const createOrder = (...args) => loadApi().then(api => api.checkout.createOrder(...args));
export const payCheckout = (...args) => loadApi().then(api => api.checkout.payCheckout(...args));
