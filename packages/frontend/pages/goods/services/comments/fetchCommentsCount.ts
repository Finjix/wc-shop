// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../../api-client';
export const fetchCommentsCount = (...args) => loadApi().then(api => api.fetchCommentsCount.fetchCommentsCount(...args));
