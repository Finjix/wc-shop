// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveRightsImages } from '../../../utils/images';
import { formatTime } from '../utils/format';
import {
  normalizeLogistics,
  normalizeOrderItem,
  normalizeServiceStatus,
  normalizeServiceType,
  serviceStatusLabel,
} from './contract';

export { formatTime };

export function getRightsDetail({ rightsNo }) {
  return request('afterSales.detail', { rightsNo }).then(async (result) => {
    const data = result && result.data !== undefined ? result.data : result;
    const source = data && data.data && !Array.isArray(data.data) ? data.data : data;
    const record = Array.isArray(source)
      ? source[0]
      : source && (source.item || source.record || source.dataList?.[0] || source.list?.[0] || source);
    if (!record) return { data: [] };
    const sourceRights = record.rights || record;
    const rights = {
      ...sourceRights,
      rightsNo: sourceRights.rightsNo || sourceRights.afterSaleId || sourceRights.id || sourceRights._id,
      orderNo: sourceRights.orderNo || sourceRights.orderId,
      rightsType: normalizeServiceType(sourceRights.rightsType ?? sourceRights.type),
      userRightsStatus: normalizeServiceStatus(sourceRights.userRightsStatus ?? sourceRights.rightsStatus ?? sourceRights.status),
      userRightsStatusName: sourceRights.userRightsStatusName || sourceRights.statusName || serviceStatusLabel(sourceRights.userRightsStatus ?? sourceRights.rightsStatus ?? sourceRights.status, sourceRights.rightsType ?? sourceRights.type),
      userRightsStatusDesc: sourceRights.userRightsStatusDesc || sourceRights.statusDesc || sourceRights.description || serviceStatusLabel(sourceRights.userRightsStatus ?? sourceRights.rightsStatus ?? sourceRights.status, sourceRights.rightsType ?? sourceRights.type),
      rightsReasonDesc: sourceRights.rightsReasonDesc || sourceRights.reason,
      refundRequestAmount: sourceRights.refundRequestAmount ?? sourceRights.refundAmount ?? sourceRights.amount,
      createTime: sourceRights.createTime || sourceRights.createdAt,
      rightsImageUrls: sourceRights.rightsImageUrls || sourceRights.images || [],
    };
    return {
      data: [await resolveRightsImages({
        ...record,
        rights,
        returnAddressSnapshot: record.returnAddressSnapshot || sourceRights.returnAddressSnapshot || null,
        rightsItem: (Array.isArray(record.rightsItem)
          ? record.rightsItem
          : Array.isArray(record.items) ? record.items : []).map(normalizeOrderItem),
        logisticsVO: normalizeLogistics(record.logisticsVO || record.logistics || {}),
      })],
    };
  });
}

export function confirmReceived(params = {}) {
  return request('afterSales.confirmReceived', params);
}

export function cancelRights(params = {}) {
  return request('afterSales.withdraw', {
    afterSaleId: params.afterSaleId || params.rightsNo,
  });
}
// @ts-nocheck
