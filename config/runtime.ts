/** CloudBase 环境配置，与当前控制台 URL 中的 envId 保持一致。 */
export const cloudEnvId = 'cloud1-d9geoogopf6e487d7';
export const cloudFunctionName = 'wc-shop-function';

/**
 * 本地开发开关。
 *
 * 微信开发者工具运行小程序时，请先启动 `npm run dev:local-backend`。
 * 发布或接入线上 CloudBase 前将它改为 false，线上配置仍保留在下方。
 */
export const useLocalBackend = true;
export const localBackendUrl = 'http://127.0.0.1:8787';
export const localUserId = 'local-user';

export const cdnBase =
  'https://we-retail-static-1300977798.cos.ap-guangzhou.myqcloud.com/retail-mp';
