// @ts-nocheck

import { OrderButtonTypes, OrderStatus } from '../config';
import { fetchOrders, fetchOrdersCount } from '../services/orderList';
import { cosThumb } from '../utils/format';

Page({
  page: {
    size: 5,
    num: 1,
  },

  data: {
    tabs: [
      { key: -1, text: '全部' },
      { key: OrderStatus.PENDING_DELIVERY, text: '待发货', info: '' },
      { key: OrderStatus.PENDING_RECEIPT, text: '待收货', info: '' },
      { key: OrderStatus.COMPLETE, text: '待评价', info: '' },
    ],
    curTab: -1,
    orderList: [],
    listLoading: 0,
    pullDownRefreshing: false,
    backRefresh: false,
    status: -1,
    pendingCommentOnly: false,
  },

  onLoad(query) {
    const requestedStatus = parseInt(query.status);
    const pendingCommentOnly =
      query.pendingComment === 'true' || requestedStatus === OrderStatus.COMPLETE;
    let status = requestedStatus;
    status = this.data.tabs.map((t) => t.key).includes(status) ? status : -1;
    this.setData(
      {
        pendingCommentOnly,
      },
      () => this.init(status),
    );
    this.pullDownRefresh = this.selectComponent('#wr-pull-down-refresh');
  },

  onShow() {
    if (!this.hasShownOnce) { this.hasShownOnce = true; return; }
    this.onRefresh();
    this.setData({ backRefresh: false });
  },

  onReachBottom() {
    if (this.data.listLoading === 0) {
      this.getOrderList(this.data.curTab);
    }
  },

  onPageScroll(e) {
    this.pullDownRefresh && this.pullDownRefresh.onPageScroll(e);
  },

  onPullDownRefresh_() {
    this.setData({ pullDownRefreshing: true });
    this.refreshList(this.data.curTab)
      .then(() => {
        this.setData({ pullDownRefreshing: false });
      })
      .catch((err) => {
        this.setData({ pullDownRefreshing: false });
        console.error('refresh orders error:', err);
      });
  },

  init(status) {
    status = status !== undefined ? status : this.data.curTab;
    this.setData({
      status,
    });
    this.refreshList(status);
  },

  getOrderList(statusCode = -1, reset = false) {
    const requestStatus = this.data.pendingCommentOnly ? OrderStatus.COMPLETE : statusCode;
    const params = {
      parameter: {
        pageSize: this.page.size,
        page: this.page.num,
        pendingCommentOnly: this.data.pendingCommentOnly,
      },
    };
    if (requestStatus !== -1) params.parameter.orderStatus = requestStatus;
    this.setData({ listLoading: 1 });
    return fetchOrders(params)
      .then((res) => {
        this.page.num++;
        let orderList = [];
        if (res && res.data && res.data.orders) {
          const sourceOrders = (res.data.orders || []).filter((order) => {
            if (!this.data.pendingCommentOnly) return true;
            return (order.buttonVOs || []).some(
              (button) => button.type === OrderButtonTypes.COMMENT,
            );
          });
          orderList = sourceOrders.map((order) => {
            return {
              id: order.orderId,
              orderNo: order.orderNo,
              commentableProductId: order.commentableProductId,
              parentOrderNo: order.parentOrderNo,
              storeId: order.storeId,
              storeName: order.storeName,
              status: order.orderStatus,
              statusDesc: order.orderStatusName,
              amount: order.paymentAmount,
              totalAmount: order.totalAmount,
              logisticsNo: order.logisticsVO?.logisticsNo,
              createTime: order.createTime,
              goodsList: (order.orderItemVOs || []).map((goods) => ({
              id: goods.id,
              thumb: cosThumb(goods.goodsPictureUrl, 70),
              title: goods.goodsName,
              orderItemId: goods.orderItemId || goods.itemId || goods.id,
              skuId: goods.skuId,
              spuId: goods.spuId,
                specs: (goods.specifications || []).map((spec) => spec.specValue),
              price: goods.actualPrice,
              num: goods.buyQuantity,
              fulfillableQuantity: goods.fulfillableQuantity,
              remainingQuantity: goods.remainingQuantity,
              })),
              buttons: (order.buttonVOs || [])
                .filter((button) => Number(button.type) !== OrderButtonTypes.APPLY_REFUND
                  || order.orderStatus === OrderStatus.PENDING_DELIVERY)
                .map((button) => Number(button.type) === OrderButtonTypes.APPLY_REFUND
                  ? { ...button, name: '取消订单', primary: false }
                  : button),
              groupInfoVo: order.groupInfoVo,
              freightFee: order.freightFee,
            };
          });
        }
        return new Promise((resolve) => {
          if (reset) {
            this.setData({ orderList: [] }, () => resolve());
          } else resolve();
        }).then(() => {
          this.setData({
            orderList: this.data.orderList.concat(orderList),
            listLoading: orderList.length > 0 ? 0 : 2,
          });
        });
      })
      .catch((err) => {
        this.setData({ listLoading: 3 });
        console.error('load order list error:', err);
        return null;
      });
  },

  onReTryLoad() {
    this.getOrderList(this.data.curTab);
  },

  onTabChange(e) {
    const { value } = e.detail;
    this.setData(
      {
        status: value,
        pendingCommentOnly: value === OrderStatus.COMPLETE,
      },
      () => this.refreshList(value),
    );
  },

  getOrdersCount() {
    return fetchOrdersCount().then((res) => {
      const tabsCount = res.data || [];
      const { tabs } = this.data;
      tabs.forEach((tab) => {
        const tabCount = tabsCount.find((c) => c.tabType === tab.key);
        if (tabCount) {
          tab.info = tabCount.orderNum;
        }
      });
      this.setData({ tabs });
    });
  },

  refreshList(status = -1) {
    this.page = {
      size: this.page.size,
      num: 1,
    };
    this.setData({ curTab: status, orderList: [] });

    return Promise.all([this.getOrderList(status, true), this.getOrdersCount()]);
  },

  onRefresh(e) {
    if (e?.detail?.action === 'confirmReceived') {
      const { orderNo, order: confirmedOrder = {} } = e.detail;
      const commentedProductIds = confirmedOrder.commentedProductIds || [];
      const orderList = this.data.orderList.map((order) => {
        if (order.orderNo !== orderNo) return order;
        const eligibleGoods = (order.goodsList || []).filter((goods) => {
          const item = confirmedOrder.items?.find((value) => value.skuId === goods.skuId);
          const remaining = item
            ? Number(item.quantity) - Number(confirmedOrder.refundedQuantities?.[goods.skuId] || 0)
            : Number(goods.fulfillableQuantity ?? goods.remainingQuantity ?? goods.num ?? 0);
          return remaining > 0 && !commentedProductIds.includes(goods.spuId);
        });
        const buttons = (order.buttons || []).filter((button) => ![
          OrderButtonTypes.CONFIRM, OrderButtonTypes.COMMENT, OrderButtonTypes.VIEW_COMMENT,
        ].includes(Number(button.type)));
        buttons.unshift(eligibleGoods.length
          ? { type: OrderButtonTypes.COMMENT, name: '评价', primary: true }
          : { type: OrderButtonTypes.VIEW_COMMENT, name: '查看评价', primary: true });
        return {
          ...order, status: OrderStatus.COMPLETE, statusDesc: '已完成',
          commentableProductId: eligibleGoods[0]?.spuId, buttons,
        };
      });
      // 保留当前筛选下的卡片，用户切换页面/筛选或主动刷新时再同步列表。
      this.setData({ orderList, backRefresh: true });
      return;
    }
    return this.refreshList(this.data.curTab);
  },

  onOrderCardTap(e) {
    const { order } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/order/order-detail/index?orderNo=${order.orderNo}`,
    });
  },
});
// @ts-nocheck
