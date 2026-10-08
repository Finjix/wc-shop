// @ts-nocheck
import { fetchOrderDetail } from '../services/orderDetail';
import { fetchCheckoutResult } from '../../../services/order/orderConfirm';

Page({
  data: {
    totalPaid: 0,
    orderNo: '',
    orderCount: 1,
    statusText: '正在读取订单状态…',
    paymentConfirmed: false,
    loading: true,
    groupId: '',
    groupon: null,
    spu: null,
    adUrl: '',
  },

  onLoad(options) {
    const { orderNo = '', checkoutId = '', groupId = '' } = options;
    this.setData({
      orderNo,
      groupId,
    });
    if (!orderNo) {
      this.setData({ loading: false, statusText: '订单编号缺失，请在订单列表中查看' });
      return;
    }
    const readResult = checkoutId ? fetchCheckoutResult(checkoutId) : fetchOrderDetail({ orderNo });
    readResult.then((result) => {
      const data = result.data || {};
      const orders = Array.isArray(data.orders) && data.orders.length ? data.orders : [data];
      const paid = orders.every((order) => {
        return order.paymentStatus === 'paid' && ['paid', 'shipped', 'received', 'completed'].includes(order.status);
      });
      const awaitingShipment = orders.every((order) => order.status === 'paid');
      this.setData({
        orderCount: orders.length,
        totalPaid: paid ? orders.reduce((sum, order) => sum + Number(order.paymentAmount ?? order.totalAmount ?? 0), 0) : 0,
        statusText: paid
          ? (orders.length > 1 ? `模拟支付完成，已生成 ${orders.length} 笔订单` : awaitingShipment ? '模拟支付完成，等待商家发货' : '模拟支付完成，请到订单列表查看发货进度')
          : '订单尚未确认完成，请到订单列表查看最新状态',
        paymentConfirmed: paid,
        loading: false,
      });
    }).catch(() => {
      this.setData({ loading: false, statusText: '订单已提交，请到订单列表查看最新状态' });
    });
  },

  onTapReturn(e) {
    const target = e.currentTarget.dataset.type;
    const { orderNo } = this.data;
    if (target === 'home') {
      wx.switchTab({ url: '/pages/home/home' });
    } else if (target === 'orderList') {
      wx.navigateTo({
        url: '/pages/order/order-list/index',
      });
    } else if (target === 'order') {
      wx.navigateTo({
        url: `/pages/order/order-detail/index?orderNo=${orderNo}`,
      });
    }
  },

  navBackHandle() {
    wx.navigateBack();
  },
});
// @ts-nocheck
