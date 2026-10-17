// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../../api-client';
export const createComment = (...args) => loadApi().then(api => api.createComment.createComment(...args));
