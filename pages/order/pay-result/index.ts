// @ts-nocheck
import { fetchOrderDetail } from '../services/orderDetail';

Page({
  data: {
    totalPaid: 0,
    orderNo: '',
    statusText: '正在读取订单状态…',
    paymentConfirmed: false,
    loading: true,
    groupId: '',
    groupon: null,
    spu: null,
    adUrl: '',
  },

  onLoad(options) {
    const { orderNo = '', groupId = '' } = options;
    this.setData({
      orderNo,
      groupId,
    });
    if (!orderNo) {
      this.setData({ loading: false, statusText: '订单编号缺失，请在订单列表中查看' });
      return;
    }
    fetchOrderDetail({ orderNo }).then((result) => {
      const order = result.data || {};
      const status = String(order.orderStatus ?? order.status ?? '').toUpperCase().replace(/[- ]/g, '_');
      const paymentStatus = String(order.paymentStatus || order.payment?.status || order.paymentVO?.status || '').toLowerCase();
      const paid = paymentStatus === 'paid' && ['10', 'PAID', 'PENDING_DELIVERY'].includes(status);
      this.setData({
        totalPaid: paid ? (order.paymentAmount ?? order.totalAmount ?? 0) : 0,
        statusText: paid ? '模拟支付完成，等待商家发货' : '订单尚未确认完成，请到订单列表查看最新状态',
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
        url: `/pages/order/order-list/index?orderNo=${orderNo}`,
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
