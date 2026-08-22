import { fetchUserCenter } from '../../services/usercenter/fetchUsercenter';
import Toast from 'tdesign-miniprogram/toast/index';
const COMPLETE_ORDER_STATUS = 50;

const ORDER_PAGE_NAVIGATION_ENABLED = true;
// 我的页优惠券入口暂时隐藏，恢复时改为 true。
const COUPON_DISPLAY_ENABLED = false;
const SUPPORT_PAGE_NAVIGATION_ENABLED = true;

const toolData = [
  {
    title: '收货地址',
    icon: 'location',
    type: 'address',
  },
  {
    title: '关于',
    icon: 'info-circle',
    type: 'about',
  },
  {
    title: '优惠券',
    icon: 'ticket',
    type: 'coupon',
  },
  {
    title: '帮助',
    icon: 'help-circle',
    type: 'help-center',
  },
  {
    title: '分销中心',
    icon: 'usergroup',
    type: 'distribution-center',
  },
];

const visibleToolData = COUPON_DISPLAY_ENABLED ? toolData : toolData.filter(({ type }) => type !== 'coupon');

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
    title: '退款/售后',
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
  userInfo: {
    avatarUrl: '',
    nickName: '用户_1A4B',
    phoneNumber: '',
  },
  toolData: visibleToolData,
  orderTagInfos,
  currAuthStep: 1,
  versionNo: '',
});

Page({
  data: getDefaultData(),

  onLoad() {
    this.initCustomNav();
  },

  onShow() {
    this.getTabBar().init();
    this.init();
  },
  onPullDownRefresh() {
    this.init();
  },

  init() {
    this.fetUseriInfoHandle();
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

  fetUseriInfoHandle() {
    fetchUserCenter().then(({ userInfo, orderTagInfos: orderInfo }) => {
      const info = orderTagInfos.map((v) => ({
        ...v,
        ...((orderInfo || []).find((item) => item.tabType === v.tabType) || {}),
      }));
      this.setData({
        userInfo,
        orderTagInfos: info,
        currAuthStep: 2,
      });
      wx.stopPullDownRefresh();
    });
  },

  onClickCell({ currentTarget }) {
    const { type } = currentTarget.dataset;

    switch (type) {
      case 'person-info': {
        wx.navigateTo({ url: '/pages/user/person-info/index' });
        break;
      }
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
      case 'point': {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '你点击了积分菜单',
          icon: '',
          duration: 1000,
        });
        break;
      }
      case 'coupon': {
        if (!COUPON_DISPLAY_ENABLED) return;

        wx.navigateTo({ url: '/pages/coupon/coupon-list/index' });
        break;
      }
      default: {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '未知跳转',
          icon: '',
          duration: 1000,
        });
        break;
      }
    }
  },

  jumpNav(e) {
    if (!ORDER_PAGE_NAVIGATION_ENABLED) return;

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
    if (!ORDER_PAGE_NAVIGATION_ENABLED) return;

    wx.navigateTo({ url: '/pages/order/order-list/index' });
  },

  gotoUserEditPage() {
    const { currAuthStep } = this.data;
    if (currAuthStep === 2) {
      wx.navigateTo({ url: '/pages/user/person-info/index' });
    } else {
      this.fetUseriInfoHandle();
    }
  },
  onSupportTap() {
    if (!SUPPORT_PAGE_NAVIGATION_ENABLED) return;

    wx.navigateTo({ url: '/pages/user/support/index' });
  },
});
