// Service implementation: services/address/fetchAddress.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../../common/services/client';
export const normalizeAddress = (...args) => loadServices().then(api => api.addresses.normalizeAddress(...args));
export const toOrderAddress = (...args) => loadServices().then(api => api.addresses.toOrderAddress(...args));
export const fetchDeliveryAddressList = (...args) => loadServices().then(api => api.addresses.fetchDeliveryAddressList(...args));
export const fetchDeliveryAddress = (...args) => loadServices().then(api => api.addresses.fetchDeliveryAddress(...args));
export const persistAddress = (...args) => loadServices().then(api => api.addresses.persistAddress(...args));
export const setDefaultDeliveryAddress = (...args) => loadServices().then(api => api.addresses.setDefaultDeliveryAddress(...args));
export const deleteDeliveryAddress = (...args) => loadServices().then(api => api.addresses.deleteDeliveryAddress(...args));
export const persistAddressList = (...args) => loadServices().then(api => api.addresses.persistAddressList(...args));
