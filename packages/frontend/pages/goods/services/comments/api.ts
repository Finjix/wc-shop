// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../../api-client';
export const normalizeCommentStatus = (...args) => loadApi().then(api => api.commentAdapter.normalizeCommentStatus(...args));
export const normalizeCommentResources = (...args) => loadApi().then(api => api.commentAdapter.normalizeCommentResources(...args));
export const normalizeComment = (...args) => loadApi().then(api => api.commentAdapter.normalizeComment(...args));
export const normalizeCommentList = (...args) => loadApi().then(api => api.commentAdapter.normalizeCommentList(...args));
export const normalizeCommentPayload = (...args) => loadApi().then(api => api.commentAdapter.normalizeCommentPayload(...args));
export const resolveCommentImages = (...args) => loadApi().then(api => api.commentAdapter.resolveCommentImages(...args));
export const resolveCommentListImages = (...args) => loadApi().then(api => api.commentAdapter.resolveCommentListImages(...args));
