import Dialog from './dialog';
import { request } from '../../../../../common/services/utils/api';

const opening = new Set<string>();

export async function openLogistics(logistics: Record<string, any> = {}, orderId = '') {
  const logisticsNo = String(logistics.logisticsNo || logistics.trackingNo || logistics.trackingNumber || '').trim();
  const pages = getCurrentPages();
  const context = pages[pages.length - 1];
  const showError = (content: string) => Dialog.alert({
    context,
    title: '物流查询失败',
    content,
    confirmBtn: null,
    actions: [
      { content: '复制物流号', variant: 'text', disabled: !logisticsNo },
      { content: '确认', variant: 'text', theme: 'primary' },
    ],
  }).then((result: { index?: number }) => {
    if (result?.index === 0 && logisticsNo) wx.setClipboardData({ data: logisticsNo });
  }).catch((error) => console.warn('物流错误弹窗打开失败', error));
  if (!logisticsNo || !orderId) {
    await showError(orderId ? '暂无可查询的物流单号' : '此运单暂不支持微信物流查询，可复制物流号联系快递公司查询');
    return;
  }
  if (opening.has(orderId)) return;
  opening.add(orderId);
  try {
    const result = await request('orders.logistics', { orderId });
    if (!result?.waybillToken) throw new Error('微信物流查询暂不可用');
    const platform = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo().platform : wx.getSystemInfoSync().platform;
    if (platform === 'devtools') {
      await Dialog.alert({ context, title: '请使用手机微信查看', content: '物流查询凭证已获取，微信物流插件需在手机微信中打开。' });
      return;
    }
    // WeChat supports loading a plugin from another package without opening a page.
    const plugin = await (requirePlugin as any).async('logisticsPlugin');
    if (typeof plugin?.openWaybillTracking !== 'function') throw new Error('PLUGIN_API_MISSING');
    await plugin.openWaybillTracking({ waybillToken: result.waybillToken });
  } catch (error) {
    if (!/cancel/i.test(String(error?.errMsg || error?.message || ''))) {
      const code = String(error?.details?.providerCode || '');
      await showError(code ? `微信物流服务暂不可用（${code}），请联系商家核查物流服务权限和运单信息` : '微信物流查询暂不可用，请稍后重试或联系商家');
    }
  } finally {
    opening.delete(orderId);
  }
}
