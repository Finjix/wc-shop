// Service implementation: services/utils/images.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../../common/services/client';
export const resolveImage = (...args) => loadServices().then(api => api.images.resolveImage(...args));
export const resolveImageList = (...args) => loadServices().then(api => api.images.resolveImageList(...args));
export const resolveOrderImages = (...args) => loadServices().then(api => api.images.resolveOrderImages(...args));
export const resolveRightsImages = (...args) => loadServices().then(api => api.images.resolveRightsImages(...args));
