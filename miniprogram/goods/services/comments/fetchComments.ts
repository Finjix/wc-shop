// Service implementation: services/goods/services/comments/fetchComments.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const fetchComments = (...args) => loadServices().then(api => api.fetchComments.fetchComments(...args));
