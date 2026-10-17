// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const normalizeAddress = (...args) => loadApi().then(api => api.addresses.normalizeAddress(...args));
export const toOrderAddress = (...args) => loadApi().then(api => api.addresses.toOrderAddress(...args));
export const fetchDeliveryAddressList = (...args) => loadApi().then(api => api.addresses.fetchDeliveryAddressList(...args));
export const fetchDeliveryAddress = (...args) => loadApi().then(api => api.addresses.fetchDeliveryAddress(...args));
export const persistAddress = (...args) => loadApi().then(api => api.addresses.persistAddress(...args));
export const setDefaultDeliveryAddress = (...args) => loadApi().then(api => api.addresses.setDefaultDeliveryAddress(...args));
export const deleteDeliveryAddress = (...args) => loadApi().then(api => api.addresses.deleteDeliveryAddress(...args));
export const persistAddressList = (...args) => loadApi().then(api => api.addresses.persistAddressList(...args));
