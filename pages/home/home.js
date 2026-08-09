import { fetchGoodsList } from '../../services/good/fetchGoods';

Page({
  data: {
    imgSrcs: [],
    swiperGoods: [],
    hotGoods: [],
    pageLoading: false,
    current: 1,
    autoplay: true,
    duration: '500',
    interval: 3000,
    navigation: { type: 'dots' },
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
      imgSrcs: [],
      swiperGoods: [],
      hotGoods: [],
    });
    this.loadCarouselGoods();
  },

  async loadCarouselGoods() {
    try {
      const goodsList = await fetchGoodsList(0, 6);
      const swiperGoods = goodsList.slice(0, 6);
      this.setData({
        swiperGoods,
        hotGoods: swiperGoods,
        imgSrcs: swiperGoods.map((item) => item.thumb),
        pageLoading: false,
      });
    } catch (err) {
      this.setData({ pageLoading: false });
    }
  },

  navToSearchPage() {
    wx.navigateTo({ url: '/pages/goods/search/index' });
  },

  navToGoodsDetail({ detail }) {
    const { index = 0 } = detail || {};
    const { spuId } = this.data.swiperGoods[index] || {};
    if (!spuId) return;

    wx.navigateTo({
      url: `/pages/goods/details/index?spuId=${spuId}`,
    });
  },

  navToHotGoodsDetail({ currentTarget }) {
    const { spuId } = currentTarget.dataset || {};
    if (spuId === undefined || spuId === null || spuId === '') return;

    wx.navigateTo({
      url: `/pages/goods/details/index?spuId=${spuId}`,
    });
  },
});
