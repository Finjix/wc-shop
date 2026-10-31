// Service implementation: services/goods/services/comments/createComment.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../../common/services/client';
export const createComment = (...args) => loadServices().then(api => api.createComment.createComment(...args));
