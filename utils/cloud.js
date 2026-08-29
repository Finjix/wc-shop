import { config } from '../config/runtime';
import { mockCallShop } from './mockApi';

const DEFAULT_CLOUD_ERROR = '云端服务暂不可用，请稍后重试';

function createCloudError(code, message, details) {
  const error = new Error(message || DEFAULT_CLOUD_ERROR);
  error.code = code || 'CLOUD_REQUEST_FAILED';
  if (details !== undefined) error.details = details;
  return error;
}

function unwrapResult(response) {
  const result = response && Object.prototype.hasOwnProperty.call(response, 'result')
    ? response.result
    : response;
  if (!result) throw createCloudError('EMPTY_CLOUD_RESPONSE', '云端返回为空，请稍后重试');
  if (result.ok === false || result.success === false || result.error) {
    const errorInfo = result.error && typeof result.error === 'object' ? result.error : result;
    throw createCloudError(errorInfo.code || result.code || 'SHOP_ACTION_FAILED', errorInfo.message || result.message || '云端请求失败，请稍后重试', errorInfo);
  }
  if (result.ok === true || result.success === true) return result.data === undefined ? result : result.data;
  return result;
}

/** 统一调用 shop 云函数，入参为 { action, data }，成功返回 data。 */
export function callShop(action, payload = {}) {
  if (!action) return Promise.reject(createCloudError('INVALID_SHOP_ACTION', '云端操作未指定'));
  if (config.useMock) return mockCallShop(action, payload);
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(createCloudError('CLOUD_UNAVAILABLE', '当前环境未启用腾讯云开发'));
  }
  return Promise.resolve()
    .then(() => wx.cloud.callFunction({
      name: config.cloudFunctionName,
      data: { action, data: payload },
    }))
    .then(unwrapResult)
    .catch((error) => {
      if (error && error.code && error.message) throw error;
      throw createCloudError(error && (error.errCode || error.code) || 'CLOUD_REQUEST_FAILED', error && (error.errMsg || error.message) || DEFAULT_CLOUD_ERROR, error);
    });
}

export function getCloudErrorMessage(error, fallback = DEFAULT_CLOUD_ERROR) {
  if (!error) return fallback;
  if (error.code === 'CLOUD_UNAVAILABLE') return '当前环境未启用云开发，请先配置 CloudBase';
  if (error.code === 'NOT_FOUND' || error.code === 'PRODUCT_NOT_FOUND') return '内容不存在或已下架';
  if (['UNAUTHORIZED', 'AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(error.code)) return '请先登录后再操作';
  return error.userMessage || error.message || error.errMsg || fallback;
}
