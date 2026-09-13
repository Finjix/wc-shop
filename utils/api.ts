/**
 * 业务层兼容入口：所有请求都经过 CloudBase 云函数，不再包含本地数据分支。
 */
export {
  ApiError,
  getApiErrorMessage,
  getTempFileUrl,
  request,
  uploadCloudFile,
} from './cloud';
export type { ApiEnvelope, ApiErrorShape } from './cloud';
