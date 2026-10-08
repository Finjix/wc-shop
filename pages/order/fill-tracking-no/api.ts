// @ts-nocheck

import { request } from '../../../utils/api';

function normalizeTrackingPayload(params = {}) {
  return {
    afterSaleId: params.afterSaleId,
    trackingNo: params.trackingNo,
    logisticsCompanyName: params.logisticsCompanyName,
  };
}

export function create(params = {}) {
  return request('afterSales.submitTracking', normalizeTrackingPayload(params));
}

export function update(params = {}) {
  return request('afterSales.submitTracking', normalizeTrackingPayload(params));
}

// @ts-nocheck
