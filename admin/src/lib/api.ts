import type { ApiEnvelope } from '../types';
import { prepareImageUpload, type UploadPhase } from './image-upload';
import { TempFileUrls } from '../../../miniprogram/services/utils/temp-file-urls';
import { cloudReadRetry } from '../../../miniprogram/services/utils/cloud-read-retry';

const localApiUrl = import.meta.env.VITE_LOCAL_API_URL?.trim() ?? '';
const adminApiUrl = localApiUrl ? `${localApiUrl.replace(/\/$/, '')}/api` : import.meta.env.VITE_ADMIN_API_URL?.trim() ?? '';

export class ApiError extends Error {
  requestId?: string;
  code?: string;

  constructor(message: string, requestId?: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.requestId = requestId;
    this.code = code;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const nested = record.error && typeof record.error === 'object'
      ? record.error as Record<string, unknown>
      : undefined;
    const code = String(record.code || record.errorCode || nested?.code || '').trim();
    const message = String(record.message || record.errMsg || nested?.message || '').trim();
    const requestId = String(record.requestId || nested?.requestId || '').trim();
    const detail = [code, message].filter(Boolean).join(': ');
    if (detail) return requestId ? `${detail}（requestId: ${requestId}）` : detail;
  }
  return '请求失败，请稍后重试。';
}

function unwrap<T>(result: ApiEnvelope<T> | undefined, requestId?: string): T {
  if (!result || result.ok !== true) {
    const error = result?.error;
    const message = typeof error === 'string' ? error : error?.message;
    const details = typeof error === 'object' && error?.details
      ? Object.entries(error.details).map(([key, value]) => `${key}=${String(value)}`).join(', ')
      : '';
    throw new ApiError(
      [result?.message || message || '云函数返回失败，请检查 wc-shop-function 云函数日志。', details].filter(Boolean).join('（') + (details ? '）' : ''),
      result?.requestId || requestId,
      typeof error === 'object' ? error?.code : undefined,
    );
  }
  return result.data;
}

async function callAdminRaw<T>(action: string, payload: Record<string, unknown> = {}) {
  if (!adminApiUrl) throw new ApiError('未配置后台 HTTP 接口地址（VITE_ADMIN_API_URL）。');
  try {
    return await cloudReadRetry(action, async () => {
      const response = await fetch(adminApiUrl, {
        method: 'POST', credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'admin', action, data: payload }),
      });
      let result: ApiEnvelope<T>;
      try { result = await response.json() as ApiEnvelope<T>; }
      catch { throw new ApiError(`后台响应无效（HTTP ${response.status}）`); }
      return unwrap(result, String(response.status));
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Admin HTTP request failed:', error);
    throw new ApiError(getErrorMessage(error));
  }
}

export async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}) {
  const result = await callAdminRaw<T>(action, payload);
  const candidates = (result as { imageCleanup?: string[] } | null)?.imageCleanup;
  if (candidates?.length || /^(products|categories|skus|homeContent|comments|orders|afterSales)\.(save|remove|delete)$/.test(action) || action === 'dashboard.summary') {
    try {
      const key = 'wc-shop.image-cleanup';
      let pending: string[] = [];
      try { pending = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* Start a fresh queue. */ }
      pending = [...new Set([...pending, ...(candidates || [])])];
      localStorage.setItem(key, JSON.stringify(pending));
      for (const catalog of [true, false]) {
        const group = pending.filter((id) => /\/(?:admin\/products|admin\/categories)\//.test(id) === catalog);
        for (let offset = 0; offset < group.length; offset += 5) {
          const cleaned = await callAdminRaw<{ deleted: string[]; retained: string[] }>('storage.cleanup', { fileList: group.slice(offset, offset + 5) });
          const finished = new Set([...cleaned.deleted, ...cleaned.retained]);
          const queue: string[] = JSON.parse(localStorage.getItem(key) || '[]');
          localStorage.setItem(key, JSON.stringify(queue.filter((id) => !finished.has(id))));
        }
      }
      await callAdminRaw('storage.cleanupQueue');
    } catch (error) { console.warn('未完成的图片清理将在下次访问时重试。', error); }
  }
  return result;
}

export async function uploadCloudFile(file: File, folder = 'admin/products', onPhase?: (phase: UploadPhase) => void) {
  onPhase?.('处理图片中…');
  file = await prepareImageUpload(file);
  onPhase?.('上传中…');
  return uploadPreparedCloudFile(file, folder);
}

export async function uploadPreparedCloudFile(file: File, folder = 'admin/products') {
  const lease = await callAdminRaw<{ cloudPath: string; fileID: string; upload?: { url: string; method: 'PUT'; headers: Record<string, string> } }>('storage.prepareUpload', { folder });
  try {
    const body = new FormData();
    if (localApiUrl) {
      body.append('folder', folder);
      body.append('cloudPath', lease.cloudPath);
      body.append('file', file);
      const response = await fetch(`${localApiUrl.replace(/\/$/, '')}/upload`, {
        method: 'POST', credentials: 'omit', headers: { 'x-upload-folder': folder }, body,
      });
      return unwrap(await response.json() as ApiEnvelope<{ fileID: string }>, String(response.status)).fileID;
    }
    if (!lease.upload) throw new ApiError('服务器未返回图片上传地址。');
    const response = await fetch(lease.upload.url, { method: lease.upload.method, credentials: 'omit', headers: lease.upload.headers, body: file });
    if (!response.ok) throw new ApiError(`图片上传失败（HTTP ${response.status}）`);
    return lease.fileID;
  } catch (error) {
    await callAdminRaw('storage.cleanup', { fileList: [lease.fileID] }).catch(() => undefined);
    throw error;
  }
}

const tempFileUrls = new TempFileUrls((fileList) => callAdmin('storage.tempUrls', { fileList }));

export async function getTempFileUrl(fileID: string) {
  if (!/^(cloud|local):\/\//i.test(fileID)) return fileID;
  return tempFileUrls.get(fileID);
}

export const adminApi = {
  call: <T>(action: string, payload: Record<string, unknown> = {}) => callAdmin<T>(action, payload),
  upload: uploadCloudFile,
  uploadPrepared: uploadPreparedCloudFile,
  getTempFileUrl,
  isLocal: Boolean(localApiUrl),
};
