// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveRightsImages } from '../../../utils/images';
import { formatTime } from '../utils/format';
import { normalizeRecord } from '../after-service-list/api';

export { formatTime };

export function getRightsDetail({ rightsNo }) {
  return request('afterSales.detail', { afterSaleId: rightsNo }).then(async (record) => ({
    data: [await resolveRightsImages(normalizeRecord(record))],
  }));
}

export function confirmReceived(params = {}) { return request('afterSales.confirmReceived', params); }
export async function cancelRights(params = {}) {
  const result = await request('afterSales.withdraw', { afterSaleId: params.rightsNo });
  getCurrentPages().forEach((page) => {
    if (page.route === 'pages/usercenter/index') {
      page.refreshOrderCounts?.();
    } else if (['pages/order/order-list/index', 'pages/order/order-detail/index', 'pages/order/after-service-list/index'].includes(page.route)) {
      page.setData({ backRefresh: true });
    }
  });
  return result;
}
