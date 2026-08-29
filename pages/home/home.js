import { fetchHomeContent } from '../../services/good/fetchHomeContent';
import { getCloudErrorMessage } from '../../utils/cloud';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

Page({
  data: {
    imgSrcs: [],
    swiperGoods: [],
    hotGoods: [],
    newGoods: [],
    domesticGoods: [],
    lubricantGoods: [],
    toyGoods: [],
    lastingGoods: [],
    pageLoading: false,
    homeLoaded: false,
    emptyInfo: '',
    current: 1,
    autoplay: true,
    duration: '500',
    interval: 3000,
    swiperImageProps: {
      mode: 'aspectFill',
      showMenuByLongpress: true,
    },
    statusBarHeight: 0,
    navBarHeight: 44,
    customNavHeight: 44,
  },

  onShow() {
    this.getTabBar().init();
  },

  onLoad() {
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
    this.init();
  },

  onPullDownRefresh() {
    this.init();
  },

  init() {
    this.loadHomePage();
  },

  loadHomePage() {
    wx.stopPullDownRefresh();

    this.setData({
      pageLoading: true,
      homeLoaded: false,
      emptyInfo: '',
      imgSrcs: [],
      swiperGoods: [],
      hotGoods: [],
      newGoods: [],
      domesticGoods: [],
      lubricantGoods: [],
      toyGoods: [],
      lastingGoods: [],
    });
    this.loadCarouselGoods();
  },

  async loadCarouselGoods() {
    try {
      const homeContent = await fetchHomeContent(36);
      const goodsList = homeContent.goodsList || [];
      const getGoodsGroup = (start) => goodsList.slice(start, start + 6);
      const hotGoods = getGoodsGroup(0);
      const newGoods = getGoodsGroup(6);
      const domesticGoods = getGoodsGroup(12);
      const lubricantGoods = getGoodsGroup(18);
      const toyGoods = getGoodsGroup(24);
      const lastingGoods = getGoodsGroup(30);
      const swiperGoods = hotGoods;
      const imgSrcs = Array.isArray(homeContent.imgSrcs) && homeContent.imgSrcs.length
        ? homeContent.imgSrcs
        : swiperGoods.map((item) => item.thumb).filter(Boolean);
      this.setData({
        swiperGoods,
        hotGoods,
        newGoods,
        domesticGoods,
        lubricantGoods,
        toyGoods,
        lastingGoods,
        imgSrcs,
        pageLoading: false,
        homeLoaded: true,
        emptyInfo: goodsList.length ? '' : '暂无首页商品内容',
      });
    } catch (err) {
      const message = getCloudErrorMessage(err, '首页内容加载失败，请稍后重试');
      this.setData({ pageLoading: false, homeLoaded: true, emptyInfo: message });
      wx.showToast({ title: message, icon: 'none' });
    }
  },

  navToSearchPage() {
    wx.navigateTo({ url: '/pages/goods/search/index' });
  },

  onDistributionBannerTap() {
    wx.showToast({
      title: '分销中心功能开发中',
      icon: 'none',
      duration: 1000,
    });
  },

  navToGoodsDetail({ detail }) {
    const { index = 0 } = detail || {};
    const { spuId } = this.data.swiperGoods[index] || {};
    if (!spuId) return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  navToHotGoodsDetail({ currentTarget }) {
    const { spuId } = currentTarget.dataset || {};
    if (spuId === undefined || spuId === null || spuId === '') return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },
});
