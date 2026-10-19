// Service implementation: services/utils/api.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const request = (...args) => loadServices().then(api => api.api.request(...args));
export const cleanupCloudFiles = (...args) => loadServices().then(api => api.api.cleanupCloudFiles(...args));
export const getTempFileUrl = (...args) => loadServices().then(api => api.api.getTempFileUrl(...args));
export const uploadCloudFile = (...args) => loadServices().then(api => api.api.uploadCloudFile(...args));
export { getApiErrorMessage } from './error-message';
