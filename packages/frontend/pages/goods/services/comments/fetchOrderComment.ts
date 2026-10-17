// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../../api-client';
export const fetchOrderComment = (...args) => loadApi().then(api => api.fetchOrderComment.fetchOrderComment(...args));
