import updateManager from './common/updateManager';
import { config } from './config/runtime';

App({
  onLaunch() {
    if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.init === 'function') {
      wx.cloud.init({
        env: config.cloudEnvId || undefined,
        traceUser: true,
      });
    }
    updateManager();
  },
  onShow() {},
});
