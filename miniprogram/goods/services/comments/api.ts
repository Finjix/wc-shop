// Service implementation: services/goods/services/comments/api.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const normalizeCommentStatus = (...args) => loadServices().then(api => api.commentAdapter.normalizeCommentStatus(...args));
export const normalizeCommentResources = (...args) => loadServices().then(api => api.commentAdapter.normalizeCommentResources(...args));
export const normalizeComment = (...args) => loadServices().then(api => api.commentAdapter.normalizeComment(...args));
export const normalizeCommentList = (...args) => loadServices().then(api => api.commentAdapter.normalizeCommentList(...args));
export const normalizeCommentPayload = (...args) => loadServices().then(api => api.commentAdapter.normalizeCommentPayload(...args));
export const resolveCommentImages = (...args) => loadServices().then(api => api.commentAdapter.resolveCommentImages(...args));
export const resolveCommentListImages = (...args) => loadServices().then(api => api.commentAdapter.resolveCommentListImages(...args));
