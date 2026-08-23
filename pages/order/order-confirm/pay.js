import Toast from 'tdesign-miniprogram/toast/index';
import { dispatchCommitPay } from '../../../services/order/orderConfirm';

export const commitPay = (params) => dispatchCommitPay(params);

// 兼容旧调用方：本阶段仅保留待支付提示，绝不调用 wx.requestPayment。
export const wechatPayOrder = (payOrderInfo, context) => {
  Toast({
    context,
    selector: '#t-toast',
    message: '订单已创建，当前为待支付状态，支付功能暂未开放',
    duration: 2000,
    icon: '',
  });
  return Promise.resolve({ pending: true, orderNo: payOrderInfo?.orderNo || payOrderInfo?.orderId });
};
