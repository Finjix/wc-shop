/**
 * 业务层统一 API 入口：请求按 config/runtime.ts 配置发送到本地开发服务或 CloudBase。
 */
export {
  ApiError,
  getApiErrorMessage,
  getTempFileUrl,
  request,
  uploadCloudFile,
} from './cloud';
export type { ApiEnvelope, ApiErrorShape } from './cloud';
