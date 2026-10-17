// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../api-client';
export const request = (...args) => loadApi().then(api => api.transport.request(...args));
export const cleanupCloudFiles = (...args) => loadApi().then(api => api.transport.cleanupCloudFiles(...args));
export const uploadCloudFile = (...args) => loadApi().then(api => api.transport.uploadCloudFile(...args));
export const getTempFileUrl = (...args) => loadApi().then(api => api.transport.getTempFileUrl(...args));
export { getApiErrorMessage } from './error-message';
