// @ts-nocheck

import { request } from '../../../utils/api';

function normalizeTrackingPayload(params = {}) {
  return {
    ...params,
    afterSaleId: params.afterSaleId || params.rightsNo,
    trackingNo: params.trackingNo || params.logisticsNo,
    logisticsNo: params.logisticsNo || params.trackingNo,
    logisticsCompanyCode: params.logisticsCompanyCode || params.companyCode || '',
    logisticsCompanyName: params.logisticsCompanyName || params.companyName || '',
  };
}

export function create(params = {}) {
  return request('afterSales.submitTracking', normalizeTrackingPayload(params));
}

export function update(params = {}) {
  return request('afterSales.submitTracking', normalizeTrackingPayload(params));
}

// @ts-nocheck
