import { cloudEnvId, cloudFunctionName, localBackendUrl, localUserId, useLocalBackend } from '../../config/runtime';
import { TempFileUrls } from './temp-file-urls';
import { LocalImageFiles } from './local-image-files';
import { cloudReadRetry } from './cloud-read-retry';

export interface ApiErrorShape {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  message?: string;
  requestId?: string;
  error?: ApiErrorShape | string;
}

export class ApiError extends Error {
  requestId?: string;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, requestId?: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.requestId = requestId;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getCloud() {
  return typeof wx !== 'undefined' ? wx.cloud : undefined;
}

function localApiUrl(path = '/api') {
  return `${localBackendUrl.replace(/\/$/, '')}${path}`;
}

function requestLocal<T>(action: string, data: Record<string, unknown>) {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: localApiUrl(),
      method: 'POST',
      data: { scope: 'shop', action, data },
      header: { 'content-type': 'application/json', 'x-local-uid': localUserId },
      success: (response) => {
        try {
          resolve(unwrap<T>(response.data));
        } catch (error) {
          reject(error);
        }
      },
      fail: reject,
    });
  });
}

function getErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (isRecord(error)) {
    const nested = isRecord(error.error) ? error.error : undefined;
    const code = String(error.code || error.errorCode || nested?.code || '').trim();
    const message = String(error.message || error.errMsg || nested?.message || '').trim();
    const requestId = String(error.requestId || nested?.requestId || '').trim();
    const detail = [code, message].filter(Boolean).join(': ');
    if (detail) return requestId ? `${detail}（requestId: ${requestId}）` : detail;
  }
  return fallback;
}

function unwrap<T>(result: unknown, requestId?: string): T {
  const envelope = isRecord(result) ? result as Partial<ApiEnvelope<T>> : undefined;
  if (!envelope || envelope.ok !== true) {
    const error = envelope?.error;
    const errorObject = isRecord(error) ? error : undefined;
    const details = errorObject?.details && isRecord(errorObject.details)
      ? Object.entries(errorObject.details).map(([key, value]) => `${key}=${String(value)}`).join(', ')
      : '';
    const message = [
      envelope?.message,
      typeof error === 'string' ? error : errorObject?.message,
      details ? `详情：${details}` : '',
    ].filter(Boolean).join('（') + (details ? '）' : '');
    throw new ApiError(
      message || '云函数返回失败，请检查 wc-shop-function 云函数日志。',
      String(envelope?.requestId || requestId || '') || undefined,
      errorObject?.code ? String(errorObject.code) : undefined,
      errorObject?.details,
    );
  }
  return envelope.data as T;
}

async function requestRaw<T = unknown>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (useLocalBackend) return requestLocal<T>(action, data);
  const cloud = getCloud();
  if (!cloudEnvId || !cloud?.callFunction) {
    throw new ApiError('CloudBase 环境未初始化，请检查 cloudEnvId 配置。', undefined, 'CLOUD_NOT_INITIALIZED');
  }
  try {
    const response = await cloudReadRetry(action, () => cloud.callFunction({
      name: cloudFunctionName,
      data: { scope: 'shop', action, data },
    })) as unknown as { result?: ApiEnvelope<T> };
    return unwrap<T>(response?.result);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('CloudBase function call failed:', action, error);
    throw new ApiError(getErrorMessage(error));
  }
}

export async function request<T = unknown>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const result = await requestRaw<T>(action, data);
  if ((result as { imageCleanup?: string[] } | null)?.imageCleanup?.length) {
    void requestRaw('storage.cleanupQueue').catch((error) => console.warn('图片清理稍后重试', error));
  }
  return result;
}

export async function cleanupCloudFiles(ids: string[]) {
  for (let offset = 0; offset < ids.length; offset += 5) {
    await requestRaw('storage.cleanup', { fileList: ids.slice(offset, offset + 5) })
      .catch((error) => console.warn('图片清理已保留在服务端队列', error));
  }
}

export async function uploadCloudFile(localPath: string, folder: 'comments' | 'after-sales' = 'comments') {
  if (folder !== 'comments' && folder !== 'after-sales') throw new ApiError('不支持该上传目录', undefined, 'FORBIDDEN');
  if (!localPath) throw new ApiError('请选择图片', undefined, 'IMAGE_FORMAT');
  const fileInfo = await new Promise<{ size: number }>((resolve, reject) => {
    (wx as any).getFileInfo({ filePath: localPath, success: resolve, fail: reject });
  });
  if (!fileInfo.size) throw new ApiError('图片文件为空', undefined, 'IMAGE_FORMAT');
  const lease = await requestRaw<{ cloudPath: string; fileID: string }>('storage.prepareUpload', { folder });
  try {
  if (useLocalBackend) {
    return await new Promise<string>((resolve, reject) => {
      wx.uploadFile({
        url: localApiUrl('/upload'),
        filePath: localPath,
        name: 'file',
        formData: { folder, cloudPath: lease.cloudPath },
        header: { 'x-upload-folder': folder },
        success: (response) => {
          try {
            const result = JSON.parse(response.data || '{}');
            if (!result.ok || !result.data?.fileID) throw new Error(result.error?.message || '本地文件上传失败');
            resolve(result.data.fileID);
          } catch (error) {
            reject(error);
          }
        },
        fail: reject,
      });
    });
  }
  const cloud = getCloud();
  if (!cloudEnvId || !cloud?.uploadFile) {
    throw new ApiError('CloudBase 环境未初始化，无法上传文件。', undefined, 'CLOUD_NOT_INITIALIZED');
  }
  const result = await cloud.uploadFile({ cloudPath: lease.cloudPath, filePath: localPath });
  return result.fileID;
  } catch (error) {
    await cleanupCloudFiles([lease.fileID]);
    throw error;
  }
}

const localImageFiles = new LocalImageFiles();
const tempFileUrls = new TempFileUrls((fileList) => request('storage.tempUrls', { fileList }));

export async function getTempFileUrl(fileID: string) {
  if (!fileID || /^(https?:|data:|wxfile:)/i.test(fileID)) return fileID;
  if (useLocalBackend && fileID.startsWith('local://')) {
    return localImageFiles.get(`${localApiUrl('/files')}?fileID=${encodeURIComponent(fileID)}`);
  }
  const cloud = getCloud();
  if (!cloud?.getTempFileURL) return fileID;
  return tempFileUrls.get(fileID);
}

export function getApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。') {
  return getErrorMessage(error, fallback);
}
