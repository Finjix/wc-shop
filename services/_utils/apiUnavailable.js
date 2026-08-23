/**
 * 真实接口尚未配置时统一返回可识别的失败，避免页面把占位字符串当成成功响应。
 */
export function apiUnavailable(serviceName) {
  const error = new Error(`${serviceName} API is not configured`);
  error.code = 'API_NOT_CONFIGURED';
  return Promise.reject(error);
}
