// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveRightsImages } from '../../../utils/images';
import { normalizeLogistics, normalizeOrderItem, normalizeServiceStatus, normalizeServiceType, normalizeServiceButtons, serviceStatusLabel } from '../after-service-detail/contract';

export function normalizeRecord(record) {
  const type = normalizeServiceType(record.type);
  const status = normalizeServiceStatus(record.status);
  return {
    ...record,
    rights: {
      ...record,
      rightsNo: record._id, // 仅用于组件定位记录，不是业务单号。
      rightsType: type,
      rightsStatus: status,
      userRightsStatus: status,
      userRightsStatusName: serviceStatusLabel(record.status, type),
      userRightsStatusDesc: record.status === 'rejected' && record.reviewReason
        ? `驳回原因：${record.reviewReason}` : serviceStatusLabel(record.status, type),
      rightsReasonDesc: record.reason,
      refundAmount: record.amount,
      refundRequestAmount: record.amount,
      createTime: record.createdAt,
      rightsImageUrls: record.images,
    },
    rightsItem: record.items.map(normalizeOrderItem),
    buttonVOs: normalizeServiceButtons(record.status, type, [], record.trackingNo || '', record.actions),
    logisticsVO: normalizeLogistics(record),
  };
}

export function getRightsList({ parameter = {} } = {}) {
  const statusMap = { 10: 'pending_review', 20: 'approved', 30: 'refunding', 50: 'refunded', 60: 'closed' };
  return request('afterSales.list', {
    page: parameter.pageNum,
    pageSize: parameter.pageSize,
    status: statusMap[parameter.afterServiceStatus],
  }).then(async (data) => ({
    data: {
      page: data.page,
      pageNum: data.page,
      pageSize: data.pageSize,
      totalCount: data.total,
      dataList: await Promise.all(data.items.filter((record) => record.status !== 'withdrawn').map((record) => resolveRightsImages(normalizeRecord(record)))),
      states: {},
    },
  }));
}
