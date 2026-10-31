// Service implementation: services/good/fetchGood.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../../common/services/client';
export const fetchGood = (...args) => loadServices().then(api => api.product.fetchGood(...args));
