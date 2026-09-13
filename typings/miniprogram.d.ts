/// <reference types="miniprogram-api-typings" />

declare namespace WechatMiniprogram {
  interface Cloud {
    init(options: { env: string; traceUser?: boolean }): void;
    callFunction<T = unknown>(options: { name: string; data?: unknown }): Promise<{ result: T }>;
    uploadFile(options: { cloudPath: string; filePath: string }): Promise<{ fileID: string }>;
    getTempFileURL(options: { fileList: string[] }): Promise<{ fileList: Array<{ fileID: string; tempFileURL?: string }> }>;
  }
}
