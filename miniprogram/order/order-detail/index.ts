// @ts-nocheck

import { formatTime } from '../utils/format';
import { getApiErrorMessage } from '../../common/services/utils/api';
import { OrderButtonTypes, OrderStatus } from '../config';
import { fetchBusinessTime, fetchOrderDetail } from '../services/orderDetail';
import { navigateToGoodsDetail } from '../../common/utils/goods-detail-navigation';
import { applyCommentToOrder } from '../utils/comment-state';

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
    if (this.skipNextShowRefresh) {
      this.skipNextShowRefresh = false;
      this.setData({ backRefresh: false });
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

  onCommentCreated({ orderNo, productId }) {
    if (this.data._order.orderNo !== orderNo) return;
    const _order = applyCommentToOrder(this.data._order, productId);
    const order = { ...this.data.order, commentedProductIds: _order.commentedProductIds,
      hasPendingComments: _order.hasPendingComments, commentableProductId: _order.commentableProductId,
      buttonVOs: _order.buttons };
    this.skipNextShowRefresh = true;
    this.setData({ _order, order, backRefresh: true });
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
          { type: OrderButtonTypes.APPLY_REFUND, name: order.orderStatus === OrderStatus.PENDING_DELIVERY ? '取消订单' : '售后申请', primary: false },
        );
      }
      const _order = {
        id: order.orderId,
        orderNo: order.orderNo,
        checkoutId: order.checkoutId,
        commentableProductId: order.commentableProductId,
        commentedProductIds: order.commentedProductIds || [],
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
    navigateToGoodsDetail(`/goods/details/index?spuId=${goods.spuId}`);
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
      url: `/order/delivery-detail/index?data=${encodeURIComponent(JSON.stringify(logistics))}`,
    });
  },

});
// @ts-nocheck
