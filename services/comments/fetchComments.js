import { config } from '../../config/index';
import { apiUnavailable } from '../_utils/apiUnavailable';

/** 获取商品评论 */
function mockFetchComments(params) {
  const { delay } = require('../_utils/delay');
  const { getGoodsAllComments } = require('../../model/comments');
  return delay().then(() => getGoodsAllComments(params));
}

/** 获取商品评论 */
export function fetchComments(params) {
  if (config.useMock) {
    return mockFetchComments(params);
  }
  return apiUnavailable('fetchComments');
}
