import { cloudEnvId, cloudFunctionName, localBackendUrl, localUserId, useLocalBackend } from '../config/runtime';

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

export async function request<T = unknown>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (useLocalBackend) return requestLocal<T>(action, data);
  const cloud = getCloud();
  if (!cloudEnvId || !cloud?.callFunction) {
    throw new ApiError('CloudBase 环境未初始化，请检查 cloudEnvId 配置。', undefined, 'CLOUD_NOT_INITIALIZED');
  }
  try {
    const response = await cloud.callFunction({
      name: cloudFunctionName,
      data: { scope: 'shop', action, data },
    }) as unknown as { result?: ApiEnvelope<T> };
    return unwrap<T>(response?.result);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('CloudBase function call failed:', action, error);
    throw new ApiError(getErrorMessage(error));
  }
}

export async function uploadCloudFile(localPath: string, folder: 'comments' | 'after-sales' | 'avatars' = 'comments') {
  if (!localPath || !/\.(jpe?g|png|webp)(?:\?|$)/i.test(localPath)) {
    throw new ApiError('只能上传 JPG、PNG 或 WebP 图片', undefined, 'IMAGE_FORMAT');
  }
  const fileInfo = await new Promise<{ size: number }>((resolve, reject) => {
    (wx as any).getFileInfo({ filePath: localPath, success: resolve, fail: reject });
  });
  if (fileInfo.size > 10 * 1024 * 1024) throw new ApiError('图片不能超过 10MB', undefined, 'IMAGE_TOO_LARGE');
  if (!fileInfo.size) throw new ApiError('图片文件为空', undefined, 'IMAGE_FORMAT');
  if (useLocalBackend) {
    return new Promise<string>((resolve, reject) => {
      wx.uploadFile({
        url: localApiUrl('/upload'),
        filePath: localPath,
        name: 'file',
        formData: { folder },
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
  const extension = localPath.split('?')[0].split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const cloudPath = `pending/user/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const result = await cloud.uploadFile({ cloudPath, filePath: localPath });
  try {
    const processed = await request<{ fileID: string }>('storage.processImage', { fileID: result.fileID });
    return processed.fileID;
  } catch (error) {
    try { await cloud.deleteFile({ fileList: [result.fileID] }); } catch { /* Keep the original upload error. */ }
    throw error;
  }
}

export async function getTempFileUrl(fileID: string) {
  if (!fileID || /^(https?:|data:|wxfile:)/i.test(fileID)) return fileID;
  if (useLocalBackend && fileID.startsWith('local://')) {
    return `${localApiUrl('/files')}?fileID=${encodeURIComponent(fileID)}`;
  }
  const cloud = getCloud();
  if (!cloud?.getTempFileURL) return fileID;
  const result = await cloud.getTempFileURL({ fileList: [fileID] });
  return result.fileList?.[0]?.tempFileURL || fileID;
}

export function getApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。') {
  return getErrorMessage(error, fallback);
}
