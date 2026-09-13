import updateManager from './common/updateManager';
import { cloudEnvId, useLocalBackend } from './config/runtime';

App({
  onLaunch() {
    if (!useLocalBackend) {
      try {
        wx.cloud.init({
          env: cloudEnvId,
          traceUser: true,
        });
      } catch (error) {
        console.error('CloudBase 初始化失败，请核对 config/runtime.ts 的 cloudEnvId。', error);
      }
    }
    updateManager();
  },
  onShow() {},
});
