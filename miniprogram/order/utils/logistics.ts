import Dialog from './dialog';

const KUAIDI100_APP_ID = 'wx6885acbedba59c14';

// 快递100官方跳转协议：https://m.kuaidi100.com/open/miniprogram.jsp
// 只传运单号；微信物流公司编码与快递100编码不同，交由对方识别公司。
export function openLogistics(logistics: Record<string, any> = {}) {
  const logisticsNo = String(logistics.logisticsNo || logistics.trackingNo || logistics.trackingNumber || '').trim();
  const pages = getCurrentPages();
  const context = pages[pages.length - 1];
  const showError = () => Dialog.alert({
    context,
    title: '物流查询失败',
    confirmBtn: '确认',
  }).catch((error) => console.warn('物流错误弹窗打开失败', error));
  if (!logisticsNo) {
    showError();
    return;
  }
  if (typeof wx.navigateToMiniProgram !== 'function') {
    showError();
    return;
  }
  // 直接在用户点击时调用；无需写剪贴板，微信会展示跳转确认弹窗。
  wx.navigateToMiniProgram({
    appId: KUAIDI100_APP_ID,
    path: `pages/result/result?nu=${encodeURIComponent(logisticsNo)}&querysource=third_xcx`,
    envVersion: 'release',
    fail(error) {
      if (/cancel/i.test(error.errMsg || '')) return;
      showError();
    },
  });
}
