// @ts-nocheck

import { formatTime } from '../utils/format';
import { getApiErrorMessage } from '../../../utils/api';
import { OrderButtonTypes, OrderStatus } from '../config';
import { fetchBusinessTime, fetchOrderDetail, updateOrderAddress } from '../services/orderDetail';
import { navigateToGoodsDetail } from '../../../utils/goods-detail-navigation';

function refundableQuantityOf(goods = {}) {
  return Math.max(0, Number(
    goods.availableRefundQuantity
      ?? goods.numOfSkuAvailable
      ?? goods.fulfillableQuantity
      ?? goods.remainingQuantity
      ?? goods.buyQuantity
      ?? 0,
  ) || 0);
}

Page({
  data: {
    pullDownRefreshing: false,
    pageLoading: true,
    loadError: '',
    order: {}, // 后台返回的原始数据
    _order: {}, // 内部使用和提供给 order-card 的数据
    storeDetail: {},
    addressEditable: false,
    backRefresh: false, // 用于接收其他页面back时的状态
    formatCreateTime: '', //格式化订单创建时间
    showLogistics: false,
  },

  onLoad(query) {
    this.orderNo = query.orderNo;
    this.init();
    this.navbar = this.selectComponent('#navbar');
    this.pullDownRefresh = this.selectComponent('#wr-pull-down-refresh');
  },

  onShow() {
    // 首次显示时 onLoad 已发起请求；后续从子页面返回都重新读取订单快照。
    if (!this.hasShownOnce) {
      this.hasShownOnce = true;
      return;
    }
    this.onRefresh();
    this.setData({ backRefresh: false });
  },

  onPageScroll(e) {
    this.pullDownRefresh && this.pullDownRefresh.onPageScroll(e);
  },

  // 页面初始化，会展示pageLoading
  init() {
    this.setData({ pageLoading: true, loadError: '' });
    this.getStoreDetail();
    return this.getDetail()
      .then(() => {
        this.setData({ pageLoading: false });
      })
      .catch((e) => {
        this.setData({ pageLoading: false, loadError: getApiErrorMessage(e, '订单加载失败，请重试') });
      });
  },

  // 页面刷新，展示下拉刷新
  onRefresh() {
    this.init();
    // 如果上一页为订单列表，通知其刷新数据
    const pages = getCurrentPages();
    const lastPage = pages[pages.length - 2];
    if (lastPage) {
      lastPage.data.backRefresh = true;
    }
  },

  // 页面刷新，展示下拉刷新
  onPullDownRefresh_() {
    this.setData({ pullDownRefreshing: true }, () => {
      this.getDetail()
        .then(() => {
          this.setData({ pullDownRefreshing: false });
        })
        .catch(() => {
          this.setData({
            pullDownRefreshing: false,
          });
        });
    });
  },

  getDetail() {
    const params = {
      parameter: this.orderNo,
    };
    return fetchOrderDetail(params).then((res) => {
      const order = res.data;
      const hasReceived = order.orderStatus === OrderStatus.COMPLETE;
      const refundableOrderStatus = [OrderStatus.PENDING_DELIVERY, OrderStatus.PENDING_RECEIPT, OrderStatus.COMPLETE].includes(order.orderStatus);
      const canApplyRefund = refundableOrderStatus
        && !(order.orderStatus === OrderStatus.PENDING_DELIVERY && order.hasPendingRefund)
        && (order.orderItemVOs || []).some((goods) => refundableQuantityOf(goods) > 0);
      const supportedButtonTypes = Object.values(OrderButtonTypes).map(Number);
      const orderButtons = (order.buttonVOs || []).filter((button) =>
        supportedButtonTypes.includes(Number(button.type))
        && (Number(button.type) !== OrderButtonTypes.APPLY_REFUND || canApplyRefund),
      );
      if (
        canApplyRefund &&
        !orderButtons.some((button) =>
          [OrderButtonTypes.APPLY_REFUND, OrderButtonTypes.VIEW_REFUND].includes(Number(button.type)),
        )
      ) {
        const actionIndex = orderButtons.findIndex((button) => [
          OrderButtonTypes.CONFIRM,
          OrderButtonTypes.COMMENT,
          OrderButtonTypes.VIEW_COMMENT,
        ].includes(Number(button.type)));
        orderButtons.splice(
          actionIndex === -1 ? orderButtons.length : actionIndex,
          0,
          { type: OrderButtonTypes.APPLY_REFUND, name: order.orderStatus === OrderStatus.PENDING_DELIVERY ? '取消订单' : '申请售后' },
        );
      }
      const _order = {
        id: order.orderId,
        orderNo: order.orderNo,
        commentableProductId: order.commentableProductId,
        parentOrderNo: order.parentOrderNo,
        storeId: order.storeId,
        storeName: order.storeName,
        status: order.orderStatus,
        statusDesc: order.orderStatusName,
        amount: order.paymentAmount,
        totalAmount: order.goodsAmountApp,
        logisticsNo: order.logisticsVO?.logisticsNo,
        goodsList: (order.orderItemVOs || []).map((goods) =>
          Object.assign({}, goods, {
            id: goods.id,
            thumb: goods.goodsPictureUrl,
            title: goods.goodsName,
            skuId: goods.skuId,
            spuId: goods.spuId,
            specs: (goods.specifications || []).map((s) => s.specValue),
            price: goods.actualPrice,
            num: goods.buyQuantity,
            fulfillableQuantity: goods.fulfillableQuantity ?? goods.remainingQuantity ?? goods.buyQuantity,
            refundableQuantity: refundableQuantityOf(goods),
            canApplyRefund: refundableOrderStatus && order.orderStatus !== OrderStatus.PENDING_DELIVERY && Boolean(goods.skuId) && refundableQuantityOf(goods) > 0,
            orderItemId: goods.orderItemId || goods.itemId || goods.id,
          }),
        ),
        buttons: orderButtons,
        createTime: order.createTime,
        receiverAddress: this.composeAddress(order),
        groupInfoVo: order.groupInfoVo,
      };
      this.setData({
        order,
        _order,
        formatCreateTime: formatTime(order.createTime, 'YYYY-MM-DD HH:mm'), // 格式化订单创建时间
        addressEditable:
          order.orderStatus === OrderStatus.PENDING_DELIVERY &&
          order.orderSubStatus !== -1 && !order.hasPendingRefund,
        showLogistics: !hasReceived,
      });
    });
  },

  // 拼接省市区
  composeAddress(order) {
    if (!order.logisticsVO) return '';
    return [
      order.logisticsVO.receiverProvince,
      order.logisticsVO.receiverCity,
      order.logisticsVO.receiverCountry,
      order.logisticsVO.receiverArea,
      order.logisticsVO.receiverAddress,
    ]
      .filter((s) => !!s)
      .join(' ');
  },

  getStoreDetail() {
    fetchBusinessTime().then((res) => {
      const storeDetail = {
        storeTel: res.data.telphone,
      };
      this.setData({ storeDetail });
    }).catch((error) => {
      wx.showToast({ title: getApiErrorMessage(error, '店铺联系信息加载失败'), icon: 'none' });
    });
  },

  onGoodsCardTap(e) {
    const { index } = e.currentTarget.dataset;
    const goods = this.data.order.orderItemVOs[index];
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${goods.spuId}`);
  },

  onApplyGoodsRefund(e) {
    const index = Number(e.currentTarget.dataset.index);
    const goods = this.data._order.goodsList[index];
    if (!goods?.canApplyRefund || !goods.skuId) return;
    const order = this.data.order || {};
    const orderStatus = Number(order.orderStatus);
    const canApplyReturn = [OrderStatus.PENDING_RECEIPT, OrderStatus.COMPLETE].includes(orderStatus);
    const params = {
      orderNo: order.orderNo || this.orderNo,
      skuId: goods.skuId,
      spuId: goods.spuId,
      orderStatus,
      logisticsNo: order.logisticsVO?.logisticsNo || '',
      canApplyReturn,
      directApply: !canApplyReturn,
    };
    const query = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value ?? '')}`)
      .join('&');
    wx.navigateTo({ url: `/pages/order/apply-service/index?${query}` });
  },

  onEditAddressTap() {
    if (!this.data.addressEditable) return;
    getApp().addressSelection.getAddressPromise()
      .then((address) => {
        wx.showLoading({ title: '正在保存' });
        return updateOrderAddress({
          orderId: this.data.order.orderId || this.data.order._id || this.orderNo,
          addressId: address.addressId || address.id || address._id,
        });
      })
      .then(() => this.onRefresh())
      .catch((error) => {
        if (!error || error.message === 'cancel') return;
        wx.showToast({ title: getApiErrorMessage(error, '收货地址保存失败'), icon: 'none' });
      })
      .finally(() => wx.hideLoading());

    wx.navigateTo({
      url: `/pages/user/address/list/index?selectMode=1`,
    });
  },

  onOrderNumCopy() {
    wx.setClipboardData({
      data: this.data.order.orderNo,
    });
  },

  onDeliveryClick() {
    const logistics = this.data.order.logisticsVO || {};
    if (!logistics.logisticsNo && !logistics.logisticsCompanyName) return;
    wx.navigateTo({
      url: `/pages/order/delivery-detail/index?data=${encodeURIComponent(JSON.stringify(logistics))}`,
    });
  },

});
// @ts-nocheck
