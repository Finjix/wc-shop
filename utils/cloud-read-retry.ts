/** A cold CloudBase instance may exceed the experience tier's 3-second limit. */
export async function cloudReadRetry<T>(action: string, invoke: () => Promise<T>): Promise<T> {
  try { return await invoke(); } catch (error) {
    const value = error as { code?: string; errorCode?: string; message?: string; errMsg?: string } | null;
    const detail = `${value?.code || value?.errorCode || ''} ${value?.message || value?.errMsg || error || ''}`;
    const read = /\.(?:get|list|preview|reasons|summary|tempUrls)$/.test(action);
    if (!read || !/\bFUNCTIONS_TIME_LIMIT_EXCEEDED\b/.test(detail)) throw error;
    // A second timeout is surfaced normally. Never replay a mutation here.
    return invoke();
  }
}
