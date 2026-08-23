import dayjs from 'dayjs';
import { callShop } from '../../../utils/cloud';
import {
  normalizeLogistics,
  normalizeOrderItem,
  normalizeServiceStatus,
  normalizeServiceType,
} from './contract';

export const formatTime = (date, template) => dayjs(date).format(template);

export function getRightsDetail({ rightsNo }) {
  return callShop('afterSales.detail', { rightsNo }).then((result) => {
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
      userRightsStatus: normalizeServiceStatus(sourceRights.userRightsStatus ?? sourceRights.status),
      userRightsStatusName: sourceRights.userRightsStatusName || sourceRights.statusName,
      userRightsStatusDesc: sourceRights.userRightsStatusDesc || sourceRights.statusDesc || sourceRights.description,
      rightsReasonDesc: sourceRights.rightsReasonDesc || sourceRights.reason,
      refundRequestAmount: sourceRights.refundRequestAmount ?? sourceRights.refundAmount ?? sourceRights.amount,
      createTime: sourceRights.createTime || sourceRights.createdAt,
      rightsImageUrls: sourceRights.rightsImageUrls || sourceRights.images || [],
    };
    return {
      data: [{
        ...record,
        rights,
        rightsItem: (Array.isArray(record.rightsItem)
          ? record.rightsItem
          : Array.isArray(record.items) ? record.items : []).map(normalizeOrderItem),
        logisticsVO: normalizeLogistics(record.logisticsVO || record.logistics || {}),
      }],
    };
  });
}

export function confirmReceived(params = {}) {
  return callShop('afterSales.confirmReceived', params);
}

export function cancelRights() {
  const error = new Error('售后撤销接口尚未开放');
  error.code = 'UNSUPPORTED_ACTION';
  return Promise.reject(error);
}
