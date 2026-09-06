import { request } from '../../../utils/api';
import {
  extractDeliveryCompanyList,
  normalizeDeliveryCompanyList,
} from '../after-service-detail/contract';

function unwrapResult(result) {
  const data = result && result.data !== undefined ? result.data : result;
  if (data && data.data !== undefined && data.data !== data) return data.data;
  return data;
}

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

export function getDeliverCompanyList(rightsNo) {
  return request('afterSales.detail', {
    rightsNo,
    includeDeliveryCompanies: true,
  }).then((result) => {
    const source = unwrapResult(result);
    const companies = extractDeliveryCompanyList(source);
    return {
      data: normalizeDeliveryCompanyList(companies),
    };
  });
}
