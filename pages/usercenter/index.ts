// @ts-nocheck

import Toast from 'tdesign-miniprogram/toast/index';
import { request } from '../../utils/api';
const COMPLETE_ORDER_STATUS = 50;

function fetchOrderCounts() { return request('orders.count').then((data) => data.items); }

async function fetchAfterSalesCount() {
  let count = 0;
  let loaded = 0;
  let page = 1;
  let data;
  do {
    data = await request('afterSales.list', { page: page++, pageSize: 20 });
    loaded += data.items.length;
    count += data.items.filter((record) => ['pending_review', 'approved', 'refunding'].includes(record.status)).length;
  } while (data.items.length && loaded < data.total);
  return count;
}

const toolData = [
  {
    title: '收货地址',
    icon: 'location',
    type: 'address',
  },
];

const orderTagInfos = [
  {
    title: '待发货',
    iconName: 'deliver',
    orderNum: 0,
    tabType: 10,
    status: 1,
  },
  {
    title: '待收货',
    iconName: 'package',
    orderNum: 0,
    tabType: 40,
    status: 1,
  },
  {
    title: '待评价',
    iconName: 'comment',
    orderNum: 0,
    tabType: COMPLETE_ORDER_STATUS,
    status: 1,
  },
  {
    title: '售后',
    iconName: 'exchang',
    orderNum: 0,
    tabType: 0,
    status: 1,
  },
];

const getDefaultData = () => ({
  statusBarHeight: 0,
  navBarHeight: 44,
  customNavHeight: 44,
  toolData,
  orderTagInfos: orderTagInfos.map((item) => ({ ...item })),
});

Page({
  data: getDefaultData(),

  onLoad() {
    this.initCustomNav();
  },

  onShow() {
    this.getTabBar().init();
    this.refreshOrderCounts();
  },
  onPullDownRefresh() {
    this.refreshOrderCounts().finally(() => wx.stopPullDownRefresh());
  },

  refreshOrderCounts() {
    const refreshOrders = fetchOrderCounts().then((counts) => {
      const orderTagInfos = this.data.orderTagInfos.map((tag) => {
        if (tag.tabType === 0) return tag;
        const match = counts.find((item) => Number(item.tabType) === Number(tag.tabType));
        return { ...tag, orderNum: Number(match?.orderNum) || 0 };
      });
      this.setData({ orderTagInfos });
    });
    const refreshAfterSales = fetchAfterSalesCount().then((total) => {
      const orderTagInfos = this.data.orderTagInfos.map((tag) =>
        tag.tabType === 0 ? { ...tag, orderNum: total } : tag,
      );
      this.setData({ orderTagInfos });
    });
    return Promise.allSettled([refreshOrders, refreshAfterSales]);
  },

  initCustomNav() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const navBarHeight = menuButtonInfo.height
      ? menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2
      : 44;

    this.setData({
      statusBarHeight,
      navBarHeight,
      customNavHeight: statusBarHeight + navBarHeight,
    });
  },

  onClickCell({ currentTarget }) {
    const { type } = currentTarget.dataset;

    switch (type) {
      case 'address': {
        wx.navigateTo({ url: '/pages/user/address/list/index' });
        break;
      }
      case 'about': {
        wx.navigateTo({ url: '/pages/user/about/index' });
        break;
      }
      case 'help-center': {
        wx.navigateTo({ url: '/pages/user/help/index' });
        break;
      }
      case 'distribution-center': {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '分销中心功能开发中',
          icon: '',
          duration: 1000,
        });
        break;
      }
    }
  },

  jumpNav(e) {
    const status = e.detail.tabType;

    if (status === 0) {
      wx.navigateTo({ url: '/pages/order/after-service-list/index' });
    } else if (status === COMPLETE_ORDER_STATUS) {
      wx.navigateTo({
        url: `/pages/order/order-list/index?status=${status}&pendingComment=true`,
      });
    } else {
      wx.navigateTo({ url: `/pages/order/order-list/index?status=${status}` });
    }
  },

  jumpAllOrder() {
    wx.navigateTo({ url: '/pages/order/order-list/index' });
  },

  gotoUserEditPage() {
    wx.navigateTo({ url: '/pages/user/person-info/index' });
  },
});
// @ts-nocheck
