import updateManager from './common/updateManager';
import { cloudEnvId } from './config/runtime';

App({
  onLaunch() {
    try {
      wx.cloud.init({
        env: cloudEnvId,
        traceUser: true,
      });
    } catch (error) {
      console.error('CloudBase 初始化失败，请核对 config/runtime.ts 的 cloudEnvId。', error);
    }
    updateManager();
  },
  onShow() {},
});
