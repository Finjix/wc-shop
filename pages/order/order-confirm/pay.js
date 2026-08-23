import Dialog from 'tdesign-miniprogram/dialog/index';
import Toast from 'tdesign-miniprogram/toast/index';
import { config } from '../../../config/index';

import { dispatchCommitPay } from '../../../services/order/orderConfirm';

// 真实的提交支付
export const commitPay = (params) => {
  return dispatchCommitPay({
    goodsRequestList: params.goodsRequestList, // 待结算的商品集合
    userAddressReq: params.userAddressReq, // 地址信息(用户在购物选择更换地址)
    currency: params.currency || 'CNY', // 支付货币: 人民币=CNY，美元=USD
    logisticsType: params.logisticsType || 1, // 配送方式 0=无需配送 1=快递 2=商家 3=同城 4=自提
    orderType: params.orderType || 0, // 订单类型 0=普通订单 1=虚拟订单
    payType: params.payType || 1, // 支付类型(0=线上、1=线下)
    totalAmount: params.totalAmount, // 新增字段"totalAmount"总的支付金额
    userName: params.userName, // 用户名
    payWay: 1,
    authorizationCode: '', //loginCode, // 登录凭证
    storeInfoList: params.storeInfoList, // 门店信息列表
  });
};

export const paySuccess = (payOrderInfo, context) => {
  const { payAmt, tradeNo } = payOrderInfo;
  // 支付成功
  Toast({
    context,
    selector: '#t-toast',
    message: '支付成功',
    duration: 2000,
    icon: 'check-circle',
  });

  const params = {
    totalPaid: payAmt,
    orderNo: tradeNo,
  };
  const paramsStr = Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k] ?? '')}`)
    .join('&');
  // 跳转支付结果页面
  wx.redirectTo({ url: `/pages/order/pay-result/index?${paramsStr}` });
};

export const payFail = (payOrderInfo = {}, resultMsg, context) => {
  if (resultMsg === 'requestPayment:fail cancel') {
    if (payOrderInfo.dialogOnCancel) {
      //结算页，取消付款，dialog提示
      Dialog.confirm({
        title: '是否放弃付款',
        content: '商品可能很快就会被抢空哦，是否放弃付款？',
        confirmBtn: '放弃',
        cancelBtn: '继续付款',
      }).then(() => {
        wx.redirectTo({ url: '/pages/order/order-list/index' });
      });
    } else {
      //订单列表页，订单详情页，取消付款，toast提示
      Toast({
        context,
        selector: '#t-toast',
        message: '支付取消',
        duration: 2000,
        icon: 'close-circle',
      });
    }
  } else {
    Toast({
      context,
      selector: '#t-toast',
      message: `支付失败：${resultMsg}`,
      duration: 2000,
      icon: 'close-circle',
    });
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/order/order-list/index' });
    }, 2000);
  }
};

// 微信支付方式
export const wechatPayOrder = (payOrderInfo, context) => {
  if (config.useMock) {
    if (config.enableMockPayment) {
      paySuccess(payOrderInfo, context);
      return Promise.resolve();
    }
    payFail(payOrderInfo, '当前为演示环境，未启用模拟支付', context);
    return Promise.reject(new Error('Mock payment is disabled'));
  }

  let payInfo;
  try {
    payInfo = typeof payOrderInfo?.payInfo === 'string'
      ? JSON.parse(payOrderInfo.payInfo)
      : payOrderInfo?.payInfo;
  } catch (error) {
    payFail(payOrderInfo, '支付参数格式错误', context);
    return Promise.reject(error);
  }

  if (!payInfo?.timeStamp || !payInfo?.nonceStr || !payInfo?.package || !payInfo?.paySign) {
    const error = new Error('支付服务未返回完整支付参数');
    payFail(payOrderInfo, error.message, context);
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: String(payInfo.timeStamp),
      nonceStr: payInfo.nonceStr,
      package: payInfo.package,
      signType: payInfo.signType || 'RSA',
      paySign: payInfo.paySign,
      success: () => {
        paySuccess(payOrderInfo, context);
        resolve();
      },
      fail: (err) => {
        const resultMsg = err?.errMsg || '未知错误';
        payFail(payOrderInfo, resultMsg, context);
        reject(err);
      },
    });
  });
};
