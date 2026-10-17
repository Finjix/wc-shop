// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../../api-client';
export const fetchComments = (...args) => loadApi().then(api => api.fetchComments.fetchComments(...args));
