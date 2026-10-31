// Service implementation: services/goods/services/comments/fetchOrderComment.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../../common/services/client';
export const fetchOrderComment = (...args) => loadServices().then(api => api.fetchOrderComment.fetchOrderComment(...args));
