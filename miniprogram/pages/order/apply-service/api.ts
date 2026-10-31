// Service implementation: services/order/apply-service/api.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../../common/services/client';
export const fetchRightsPreview = (...args) => loadServices().then(api => api.afterSaleApply.fetchRightsPreview(...args));
export const fetchApplyReasonList = (...args) => loadServices().then(api => api.afterSaleApply.fetchApplyReasonList(...args));
export const dispatchConfirmReceived = (...args) => loadServices().then(api => api.afterSaleApply.dispatchConfirmReceived(...args));
export const dispatchApplyService = (...args) => loadServices().then(api => api.afterSaleApply.dispatchApplyService(...args));
