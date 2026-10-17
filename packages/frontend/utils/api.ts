// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../api-client';
export const request = (...args) => loadApi().then(api => api.api.request(...args));
export const cleanupCloudFiles = (...args) => loadApi().then(api => api.api.cleanupCloudFiles(...args));
export const getTempFileUrl = (...args) => loadApi().then(api => api.api.getTempFileUrl(...args));
export const uploadCloudFile = (...args) => loadApi().then(api => api.api.uploadCloudFile(...args));
export { getApiErrorMessage } from './error-message';
