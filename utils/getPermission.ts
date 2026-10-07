import { showConfirmModal } from './confirm-modal';

export const getPermission = ({ code, name }: { code: string; name: string }) => {
  return new Promise<void>((resolve, reject) => {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting[code] === false) {
          showConfirmModal({
            title: `获取${name}失败`,
            content: `获取${name}失败，请在【右上角】-小程序【设置】项中，将【${name}】开启。`,
            confirmText: '确定',
            confirmColor: '#695941',
            cancelText: '取消',
            success(res) {
              if (res.confirm) {
                wx.openSetting({
                  success(settingRes) {
                    if (settingRes.authSetting[code] === true) {
                      resolve();
                    } else {
                      console.warn('用户未打开权限', name, code);
                      reject();
                    }
                  },
                });
              } else {
                reject();
              }
            },
            fail() {
              reject();
            },
          });
        } else {
          resolve();
        }
      },
      fail() {
        reject();
      },
    });
  });
};
