import dayjs from 'dayjs';
import {
  createMockResponse,
  getAfterServiceDetail,
} from '../../../model/order/afterService';

export const formatTime = (date, template) => dayjs(date).format(template);

export function getRightsDetail({ rightsNo }) {
  return Promise.resolve(createMockResponse(getAfterServiceDetail(rightsNo)));
}

export function cancelRights() {
  return Promise.resolve(createMockResponse({}));
}
