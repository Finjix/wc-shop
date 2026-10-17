// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../api-client';
export const resolveImage = (...args) => loadApi().then(api => api.images.resolveImage(...args));
export const resolveImageList = (...args) => loadApi().then(api => api.images.resolveImageList(...args));
export const resolveOrderImages = (...args) => loadApi().then(api => api.images.resolveOrderImages(...args));
export const resolveRightsImages = (...args) => loadApi().then(api => api.images.resolveRightsImages(...args));
