import type { ApiEnvelope } from '../types';
import { prepareImageUpload, type UploadPhase } from './image-upload';
import { TempFileUrls } from '../../../miniprogram/services/utils/temp-file-urls';

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

const isReadAction = (action: string) => /\.(get|list|preview|reasons|summary|tempUrls)$/.test(action);

// Bound the whole request, including reading the response body. A stalled read
// must settle so its shared promise can be removed and the page can retry.
async function withRequestTimeout<T>(invoke: (signal: AbortSignal) => Promise<T>, timeoutMs: number, message: string, requestId?: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError(message, requestId, 'REQUEST_TIMEOUT'));
      controller.abort();
    }, timeoutMs);
  });
  try { return await Promise.race([invoke(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

async function callAdminRaw<T>(action: string, payload: Record<string, unknown> = {}) {
  if (!adminApiUrl) throw new ApiError('未配置后台 HTTP 接口地址（VITE_ADMIN_API_URL）。');
  const read = isReadAction(action);
  // NetLog showed requests blackholed after reusing idle HTTP/1.1 sockets.
  // Abort a stalled read before retrying, so the dead socket is discarded.
  // Never replay writes: the server may already have committed them.
  const attemptTimeouts = read ? [6_000, 6_000, 8_000] : [45_000];
  for (let attempt = 0; attempt < attemptTimeouts.length; attempt++) {
    const traceId = `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = Date.now();
    console.info('ADMIN_HTTP', JSON.stringify({ traceId, action, phase: 'start', attempt: attempt + 1 }));
    try {
      return await withRequestTimeout(async (signal) => {
        const response = await fetch(adminApiUrl, {
          method: 'POST', credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'admin', action, data: payload, traceId }),
          signal,
        });
        console.info('ADMIN_HTTP', JSON.stringify({ traceId, action, phase: 'headers', status: response.status, elapsedMs: Date.now() - startedAt }));
        let result: ApiEnvelope<T>;
        try { result = await response.json() as ApiEnvelope<T>; }
        catch { throw new ApiError(`后台响应无效（HTTP ${response.status}）`); }
        console.info('ADMIN_HTTP', JSON.stringify({ traceId, action, phase: 'complete', elapsedMs: Date.now() - startedAt, requestId: result.requestId }));
        return unwrap(result, String(response.status));
      }, attemptTimeouts[attempt], read
        ? '加载超时，请检查网络后重试。'
        : '操作响应超时，请刷新页面核实是否已保存，再决定是否重试。', traceId);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'NETWORK_ERROR';
      console.warn('ADMIN_HTTP', JSON.stringify({ traceId, action, phase: 'failed', elapsedMs: Date.now() - startedAt, code }));
      const transient = code === 'REQUEST_TIMEOUT' || code === 'NETWORK_ERROR'
        || /\bFUNCTIONS_TIME_LIMIT_EXCEEDED\b/.test(getErrorMessage(error));
      if (read && transient && attempt + 1 < attemptTimeouts.length) continue;
      if (error instanceof ApiError) throw error;
      console.error('Admin HTTP request failed:', error);
      throw new ApiError(getErrorMessage(error));
    }
  }
  throw new ApiError('请求失败，请稍后重试。');
}

const pendingReads = new Map<string, Promise<unknown>>();
let cleanupRunning: Promise<void> | null = null;

function cleanupInBackground(candidates: string[]) {
  const key = 'wc-shop.image-cleanup';
  try {
    let pending: string[] = [];
    try { pending = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* Recover a corrupt client queue. */ }
    if (!Array.isArray(pending)) pending = [];
    pending = [...new Set([...pending.filter((id) => typeof id === 'string'), ...candidates])];
    if (!pending.length) return;
    localStorage.setItem(key, JSON.stringify(pending));
  } catch { return; /* The server timer still owns the durable queue. */ }
  if (cleanupRunning) return;
  cleanupRunning = (async () => {
    try {
      const key = 'wc-shop.image-cleanup';
      const pending: string[] = JSON.parse(localStorage.getItem(key) || '[]');
      for (const catalog of [true, false]) {
        const group = pending.filter((id) => /\/(?:admin\/products|admin\/categories)\//.test(id) === catalog);
        for (let offset = 0; offset < group.length; offset += 5) {
          const cleaned = await callAdminRaw<{ deleted: string[]; retained: string[] }>('storage.cleanup', { fileList: group.slice(offset, offset + 5) });
          const finished = new Set([...cleaned.deleted, ...cleaned.retained]);
          const queue: string[] = JSON.parse(localStorage.getItem(key) || '[]');
          localStorage.setItem(key, JSON.stringify(queue.filter((id) => !finished.has(id))));
        }
      }
    } catch (error) { console.warn('未完成的图片清理将在下次访问时重试。', error); }
  })().finally(() => { cleanupRunning = null; });
}

export async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}) {
  // Share only in-flight reads; never cache inventory or replay a mutation.
  const key = isReadAction(action) ? `${action}:${JSON.stringify(payload)}` : '';
  let request = key ? pendingReads.get(key) as Promise<T> | undefined : undefined;
  if (!request) {
    request = callAdminRaw<T>(action, payload).finally(() => { if (key) pendingReads.delete(key); });
    if (key) pendingReads.set(key, request);
  }
  const result = await request;
  cleanupInBackground((result as { imageCleanup?: string[] } | null)?.imageCleanup || []);
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
      return await withRequestTimeout(async (signal) => {
        const response = await fetch(`${localApiUrl.replace(/\/$/, '')}/upload`, {
          method: 'POST', credentials: 'omit', headers: { 'x-upload-folder': folder }, body, signal,
        });
        return unwrap(await response.json() as ApiEnvelope<{ fileID: string }>, String(response.status)).fileID;
      }, 90_000, '图片上传超时，请检查网络后重试。');
    }
    if (!lease.upload) throw new ApiError('服务器未返回图片上传地址。');
    const response = await withRequestTimeout((signal) => fetch(lease.upload!.url, { method: lease.upload!.method, credentials: 'omit', headers: lease.upload!.headers, body: file, signal }), 90_000, '图片上传超时，请检查网络后重试。');
    if (!response.ok) throw new ApiError(`图片上传失败（HTTP ${response.status}）`);
    return lease.fileID;
  } catch (error) {
    cleanupInBackground([lease.fileID]);
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
