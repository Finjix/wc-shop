// Service implementation: services/order/after-service-detail/api.ts
// @ts-nocheck
// Async boundary: implementation and mutable service state live in services.
import { loadServices } from '../../common/services/client';
export const getRightsDetail = (...args) => loadServices().then(api => api.afterSaleDetail.getRightsDetail(...args));
export const confirmReceived = (...args) => loadServices().then(api => api.afterSaleDetail.confirmReceived(...args));
const withdrawRights = (...args) => loadServices().then(api => api.afterSaleDetail.cancelRights(...args));
export { formatTime } from '../utils/format';

export async function cancelRights(params = {}) {
  const result = await withdrawRights(params);
  getCurrentPages().forEach(page => {
    if (page.route === 'pages/usercenter/index') page.refreshOrderCounts?.();
    else if (['order/order-list/index','order/order-detail/index','order/after-service-list/index'].includes(page.route)) page.setData({ backRefresh: true });
  });
  return result;
}
