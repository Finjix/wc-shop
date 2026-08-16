import { fetchGoodsList } from '../../services/good/fetchGoods';
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
    headerHeight: 140,
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
    }, () => this.updateHeaderHeight());
    this.init();
  },

  updateHeaderHeight() {
    wx.createSelectorQuery()
      .select('.home-page-header')
      .boundingClientRect((rect) => {
        if (rect && rect.height && rect.height !== this.data.headerHeight) {
          this.setData({ headerHeight: rect.height });
        }
      })
      .exec();
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
      const goodsList = await fetchGoodsList(0, 36);
      const getGoodsGroup = (start) => goodsList.slice(start, start + 6);
      const hotGoods = getGoodsGroup(0);
      const newGoods = getGoodsGroup(6);
      const domesticGoods = getGoodsGroup(12);
      const lubricantGoods = getGoodsGroup(18);
      const toyGoods = getGoodsGroup(24);
      const lastingGoods = getGoodsGroup(30);
      const swiperGoods = hotGoods;
      this.setData({
        swiperGoods,
        hotGoods,
        newGoods,
        domesticGoods,
        lubricantGoods,
        toyGoods,
        lastingGoods,
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

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  navToHotGoodsDetail({ currentTarget }) {
    const { spuId } = currentTarget.dataset || {};
    if (spuId === undefined || spuId === null || spuId === '') return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },
});
