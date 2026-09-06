import updateManager from './common/updateManager';

App({
  onLaunch() {
    updateManager();
  },
  onShow() {},
});
