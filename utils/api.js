const DEFAULT_API_ERROR = '当前仅保留前端界面，数据服务未配置';

function createApiError(message) {
  const error = new Error(message || DEFAULT_API_ERROR);
  error.code = 'API_UNAVAILABLE';
  return error;
}

/** 前端版不包含任何后端实现；保留统一调用入口以维持页面错误态。 */
export function request() {
  return Promise.reject(createApiError());
}

export function getApiErrorMessage(error, fallback = DEFAULT_API_ERROR) {
  if (!error) return fallback;
  return error.userMessage || error.message || error.errMsg || fallback;
}
