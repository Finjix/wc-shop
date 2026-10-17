function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


export function getApiErrorMessage(error: unknown, fallback = '请求失败，请稍后重试。') {
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
