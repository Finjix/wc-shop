// Service implementation: services/utils/cloud.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const request = (...args) => loadServices().then(api => api.transport.request(...args));
export const cleanupCloudFiles = (...args) => loadServices().then(api => api.transport.cleanupCloudFiles(...args));
export const uploadCloudFile = (...args) => loadServices().then(api => api.transport.uploadCloudFile(...args));
export const getTempFileUrl = (...args) => loadServices().then(api => api.transport.getTempFileUrl(...args));
export { getApiErrorMessage } from './error-message';
