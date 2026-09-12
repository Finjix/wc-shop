import { createPaidOrder, prepareWechatPayment } from '../../../services/order/orderConfirm';

export const preparePayment = (params) => prepareWechatPayment(params);
export const createOrderAfterPayment = (params, paymentInfo) => createPaidOrder(params, paymentInfo);

function parsePayInfo(payOrderInfo = {}) {
  let payInfo = payOrderInfo.payInfo || payOrderInfo.paymentInfo || payOrderInfo;
  if (typeof payInfo === 'string') {
    try {
      payInfo = JSON.parse(payInfo);
    } catch (error) {
      const parseError = new Error('支付参数格式错误');
      parseError.code = 'PAYMENT_PARAMS_INVALID';
      throw parseError;
    }
  }
  return payInfo?.paymentInfo || payInfo;
}

/** 调起微信支付。支付失败或取消时不会创建商城订单。 */
export function wechatPayOrder(payOrderInfo = {}) {
  // 本地接口没有真实商户支付参数，用成功回调模拟支付；生产接口会直接调起微信支付。
  if (payOrderInfo.mockPayment) return Promise.resolve({ mock: true });

  let payInfo;
  try {
    payInfo = parsePayInfo(payOrderInfo);
  } catch (error) {
    return Promise.reject(error);
  }

  if (!payInfo?.timeStamp || !payInfo?.nonceStr || !payInfo?.package || !payInfo?.paySign) {
    const error = new Error('支付服务未返回完整支付参数');
    error.code = 'PAYMENT_PARAMS_INVALID';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: String(payInfo.timeStamp),
      nonceStr: payInfo.nonceStr,
      package: payInfo.package,
      signType: payInfo.signType || 'RSA',
      paySign: payInfo.paySign,
      success: resolve,
      fail: reject,
    });
  });
}
