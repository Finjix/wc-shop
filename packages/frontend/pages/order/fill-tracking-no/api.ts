// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const create = (...args) => loadApi().then(api => api.returnTracking.create(...args));
export const update = (...args) => loadApi().then(api => api.returnTracking.update(...args));
