// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const fetchRightsPreview = (...args) => loadApi().then(api => api.afterSaleApply.fetchRightsPreview(...args));
export const fetchApplyReasonList = (...args) => loadApi().then(api => api.afterSaleApply.fetchApplyReasonList(...args));
export const dispatchConfirmReceived = (...args) => loadApi().then(api => api.afterSaleApply.dispatchConfirmReceived(...args));
export const dispatchApplyService = (...args) => loadApi().then(api => api.afterSaleApply.dispatchApplyService(...args));
