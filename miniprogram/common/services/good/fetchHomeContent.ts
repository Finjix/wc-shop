// Service implementation: services/good/fetchHomeContent.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../client';
export const fetchHomeContent = (...args) => loadServices().then(api => api.home.fetchHomeContent(...args));
export const fetchHomeFeed = (...args) => loadServices().then(api => api.home.fetchHomeFeed(...args));
