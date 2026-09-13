import { cloudbaseApp, requireCloudBase } from './cloudbase';
import type { ApiEnvelope } from '../types';

const localApiUrl = import.meta.env.VITE_LOCAL_API_URL?.trim() ?? '';
const localSessionKey = 'wc-shop.local-admin-session';

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

function localSession() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(localSessionKey);
    return value ? JSON.parse(value) as { uid?: string; username?: string } : null;
  } catch {
    return null;
  }
}

function localHeaders() {
  const session = localSession();
  return {
    'content-type': 'application/json',
    'x-local-uid': session?.uid || 'local-admin',
  };
}

async function callLocal<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(`${localApiUrl.replace(/\/$/, '')}/api`, {
    method: 'POST',
    headers: localHeaders(),
    body: JSON.stringify({ scope: 'admin', action, data: payload }),
  });
  let result: ApiEnvelope<T> | undefined;
  try {
    result = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`本地后台响应无效（HTTP ${response.status}）`);
  }
  return unwrap(result, String(response.status));
}

async function localLogin(username: string, password: string) {
  const response = await fetch(`${localApiUrl.replace(/\/$/, '')}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const result = await response.json() as ApiEnvelope<{ uid: string; username: string }>;
  const session = unwrap(result, String(response.status));
  window.localStorage.setItem(localSessionKey, JSON.stringify(session));
  return session;
}

function clearLocalSession() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(localSessionKey);
}

export async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}) {
  if (localApiUrl) return callLocal<T>(action, payload);
  const { app } = requireCloudBase();
  try {
    const response = await app.callFunction({
      name: 'wc-shop-function',
      data: { scope: 'admin', action, data: payload },
    }) as { result: ApiEnvelope<T>; requestId?: string };
    return unwrap(response.result, response.requestId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('CloudBase admin function call failed:', error);
    throw new ApiError(getErrorMessage(error));
  }
}

export async function uploadCloudFile(file: File, folder = 'admin/products') {
  if (localApiUrl) {
    const response = await fetch(`${localApiUrl.replace(/\/$/, '')}/upload`, {
      method: 'POST',
      headers: localHeaders(),
      body: JSON.stringify({
        folder,
        name: file.name,
        content: Array.from(new Uint8Array(await file.arrayBuffer())),
      }),
    });
    const result = await response.json() as ApiEnvelope<{ fileID: string }>;
    return unwrap(result, String(response.status)).fileID;
  }
  if (!cloudbaseApp) throw new ApiError('未配置 CloudBase 环境 ID，无法上传图片。');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cloudPath = `${folder}/${Date.now()}-${safeName}`;
  const result = await cloudbaseApp.uploadFile({
    cloudPath,
    filePath: file.name,
    fileContent: file,
  });
  return result.fileID;
}

export async function getTempFileUrl(fileID: string) {
  if (localApiUrl) {
    const result = await callLocal<Array<{ fileID: string; tempFileURL?: string }>>('storage.tempUrls', { fileList: [fileID] });
    return result?.[0]?.tempFileURL || fileID;
  }
  if (!cloudbaseApp) throw new ApiError('未配置 CloudBase 环境 ID，无法读取图片。');
  const result = await cloudbaseApp.getTempFileURL({ fileList: [fileID] });
  return result.fileList?.[0]?.tempFileURL || fileID;
}

export const adminApi = {
  call: <T>(action: string, payload: Record<string, unknown> = {}) => callAdmin<T>(action, payload),
  upload: uploadCloudFile,
  getTempFileUrl,
  isLocal: Boolean(localApiUrl),
  localLogin,
  localSession,
  clearLocalSession,
};
