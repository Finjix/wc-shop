// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveRightsImages } from '../../../utils/images';
import {
  normalizeLogistics,
  normalizeOrderItem,
  normalizeServiceStatus,
  normalizeServiceType,
  normalizeServiceButtons,
  serviceStatusLabel,
} from '../after-service-detail/contract';

function unwrapData(result) {
  const data = result && result.data !== undefined ? result.data : result;
  if (data && data.data && !Array.isArray(data.data)) return data.data;
  return data || {};
}

function normalizeRecord(record) {
  const source = record || {};
  const rights = source.rights || source;
  const rightsItem = source.rightsItem || source.items || rights.rightsItem || rights.items || [];
  const normalizedType = normalizeServiceType(rights.rightsType ?? rights.type);
  const normalizedStatus = normalizeServiceStatus(rights.rightsStatus ?? rights.status);
  return {
    ...source,
    rights: {
      ...rights,
      rightsNo: rights.rightsNo || rights.afterSaleId || rights.id || rights._id,
      orderNo: rights.orderNo || rights.orderId,
      rightsType: normalizedType,
      rightsStatus: normalizedStatus,
      userRightsStatus: normalizeServiceStatus(rights.userRightsStatus ?? rights.rightsStatus ?? rights.status),
      userRightsStatusName: rights.userRightsStatusName || rights.statusName || serviceStatusLabel(rights.status ?? rights.rightsStatus, normalizedType),
      userRightsStatusDesc: rights.userRightsStatusDesc || rights.statusDesc || rights.description || serviceStatusLabel(rights.status ?? rights.rightsStatus, normalizedType),
      rightsReasonDesc: rights.rightsReasonDesc || rights.reason,
      refundAmount: rights.refundAmount ?? rights.refundRequestAmount ?? rights.amount,
    },
    rightsItem: Array.isArray(rightsItem) ? rightsItem.map(normalizeOrderItem) : [],
    buttonVOs: normalizeServiceButtons(
      rights.status ?? rights.rightsStatus,
      normalizedType,
      source.buttonVOs || rights.buttonVOs || rights.buttons || [],
      (source.logisticsVO || rights.logisticsVO || source.logistics || {}).logisticsNo,
    ),
    returnAddressSnapshot: source.returnAddressSnapshot || rights.returnAddressSnapshot || null,
    logisticsVO: normalizeLogistics(source.logisticsVO || rights.logisticsVO || source.logistics || {}),
  };
}

export function getRightsList({ parameter = {} } = {}) {
  const pageNum = Number(parameter.pageNum) || 1;
  const pageSize = Number(parameter.pageSize) || 10;
  const statusMap = { 10: 'pending_review', 20: 'approved', 30: 'refunding', 50: 'refunded', 60: 'rejected' };
  return request('afterSales.list', {
    ...parameter,
    pageNum,
    page: Number(parameter.page ?? pageNum) || pageNum,
    pageSize,
    ...(parameter.afterServiceStatus !== undefined && statusMap[parameter.afterServiceStatus]
      ? { status: statusMap[parameter.afterServiceStatus] }
      : {}),
  }).then(async (result) => {
    const data = unwrapData(result);
    const records = data.dataList || data.list || data.items || data.records || [];
    return {
      data: {
        ...data,
        page: Number(data.page ?? data.pageNum ?? pageNum) || pageNum,
        pageNum: Number(data.pageNum ?? data.page ?? pageNum) || pageNum,
        pageSize: Number(data.pageSize ?? pageSize) || pageSize,
        totalCount: Number(data.totalCount ?? data.total ?? data.totalRecords ?? records.length),
        dataList: Array.isArray(records) ? await Promise.all(records.map((record) => resolveRightsImages(normalizeRecord(record)))) : [],
        states: data.states || {},
      },
    };
  });
}
// @ts-nocheck
