// Service implementation: services/goods/services/comments/fetchCommentsCount.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const fetchCommentsCount = (...args) => loadServices().then(api => api.fetchCommentsCount.fetchCommentsCount(...args));
