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
    const plugin = requirePlugin('logisticsPlugin');
    const result = await request('orders.logistics', { orderId });
    if (!result?.waybillToken) throw new Error('微信物流查询暂不可用');
    await plugin.openWaybillTracking({ waybillToken: result.waybillToken });
  } catch (error) {
    if (!/cancel/i.test(String(error?.errMsg || error?.message || ''))) {
      await showError('微信物流查询暂不可用，请稍后重试或联系商家');
    }
  } finally {
    opening.delete(orderId);
  }
}
