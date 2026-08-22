import { config } from '../../config/index';

function mockFetchOrderComment(orderNo) {
  const { delay } = require('../_utils/delay');
  const { getOrderComment } = require('../../model/comments');
  return delay().then(() => getOrderComment(orderNo));
}

export function fetchOrderComment(orderNo) {
  if (config.useMock) {
    return mockFetchOrderComment(orderNo);
  }
  return new Promise((resolve) => {
    resolve(null);
  });
}
