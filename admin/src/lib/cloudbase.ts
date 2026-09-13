import cloudbase from '@cloudbase/js-sdk';

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim() ?? '';

export const cloudbaseEnvId = envId;
export const cloudbaseApp = envId ? cloudbase.init({ env: envId }) : null;
export const cloudbaseAuth = cloudbaseApp?.auth({ persistence: 'local' });

export function requireCloudBase() {
  if (!cloudbaseApp || !cloudbaseAuth) {
    throw new Error('未配置 VITE_CLOUDBASE_ENV_ID，无法连接 CloudBase。');
  }
  return { app: cloudbaseApp, auth: cloudbaseAuth };
}
