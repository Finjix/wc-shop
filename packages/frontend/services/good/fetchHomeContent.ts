// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../api-client';
export const fetchHomeContent = (...args) => loadApi().then(api => api.home.fetchHomeContent(...args));
