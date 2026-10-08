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
export function cancelRights(params = {}) { return request('afterSales.withdraw', { afterSaleId: params.rightsNo }); }
