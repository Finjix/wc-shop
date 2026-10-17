// @ts-nocheck
// Async boundary: implementation and mutable service state live in api.
import { loadApi } from '../../../api-client';
export const getRightsDetail = (...args) => loadApi().then(api => api.afterSaleDetail.getRightsDetail(...args));
export const confirmReceived = (...args) => loadApi().then(api => api.afterSaleDetail.confirmReceived(...args));
const withdrawRights = (...args) => loadApi().then(api => api.afterSaleDetail.cancelRights(...args));
export { formatTime } from '../utils/format';

export async function cancelRights(params = {}) {
  const result = await withdrawRights(params);
  getCurrentPages().forEach(page => {
    if (page.route === 'pages/usercenter/index') page.refreshOrderCounts?.();
    else if (['packages/frontend/pages/order/order-list/index','packages/frontend/pages/order/order-detail/index','packages/frontend/pages/order/after-service-list/index'].includes(page.route)) page.setData({ backRefresh: true });
  });
  return result;
}
