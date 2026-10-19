// Service implementation: services/order/fill-tracking-no/api.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../common/services/client';
export const create = (...args) => loadServices().then(api => api.returnTracking.create(...args));
export const update = (...args) => loadServices().then(api => api.returnTracking.update(...args));
