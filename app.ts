import updateManager from './common/updateManager';
import { createAddressSelection } from './common/address-selection';
import { cloudEnvId, useLocalBackend } from './config/runtime';

App({
  addressSelection: createAddressSelection(),
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
  recommendationSession: 0,
  onShow() {
    this.recommendationSession += 1;
  },
});
