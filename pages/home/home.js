import { fetchHomeContent } from '../../services/good/fetchHomeContent';
import { addSearchHistory } from '../../services/good/fetchSearchHistory';
import { getCloudErrorMessage } from '../../utils/cloud';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

const HOME_GOODS_LIMIT = 6;
const HOME_SHOWCASE_CARD_LIMIT = 8;

Page({
  data: {
    imgSrcs: [],
    swiperGoods: [],
    dynamicGoods: [],
    dynamicGoodsSrcs: [],
    dynamicCurrent: 0,
    hotGoods: [],
    hotShowcaseGoods: [],
    newGoods: [],
    domesticGoods: [],
    lubricantGoods: [],
    toyGoods: [],
    lastingGoods: [],
    productHeroSrc: '',
    pageLoading: false,
    homeLoaded: false,
    current: 1,
    autoplay: true,
    duration: '500',
    interval: 3000,
    swiperImageProps: {
      mode: 'aspectFill',
      showMenuByLongpress: true,
    },
    featuredSwiperImageProps: {
      mode: 'aspectFill',
      shape: 'round',
      customStyle: 'border-radius: 48rpx; overflow: hidden; --td-image-round-radius: 48rpx;',
      showMenuByLongpress: true,
    },
    searchTop: 0,
    searchLeft: 0,
    searchWidth: 375,
    searchHeight: 32,
    searchRadius: 16,
    searchValue: '',
    searchFocus: false,
  },

  onShow() {
    this.getTabBar().init();
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const windowWidth = windowInfo.windowWidth || 375;
    const searchHeight = menuButtonInfo.height || (64 * windowWidth / 750);
    const screenSideGap = Math.max(windowWidth - (menuButtonInfo.right || windowWidth), 0);
    const menuButtonLeft = menuButtonInfo.left || windowWidth;
    const menuButtonTop = menuButtonInfo.top || 0;

    this.setData({
      searchTop: menuButtonTop,
      searchLeft: screenSideGap,
      searchWidth: Math.max(menuButtonLeft - screenSideGap * 2, 0),
      searchHeight,
      searchRadius: searchHeight / 2,
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
      imgSrcs: [],
      swiperGoods: [],
      dynamicGoods: [],
      dynamicGoodsSrcs: [],
      hotGoods: [],
      hotShowcaseGoods: [],
      newGoods: [],
      domesticGoods: [],
      lubricantGoods: [],
      toyGoods: [],
      lastingGoods: [],
      productHeroSrc: '',
    });
    this.loadCarouselGoods();
  },

  async loadCarouselGoods() {
    try {
      const homeContent = await fetchHomeContent(36);
      const goodsList = homeContent.goodsList || [];
      const getGoodsGroup = (start) => goodsList.slice(start, start + HOME_GOODS_LIMIT);
      const hotGoods = getGoodsGroup(0);
      const newGoods = getGoodsGroup(6);
      const domesticGoods = getGoodsGroup(12);
      const lubricantGoods = getGoodsGroup(18);
      const toyGoods = getGoodsGroup(24);
      const lastingGoods = getGoodsGroup(30);
      const swiperGoods = hotGoods;
      const dynamicGoods = hotGoods.filter((item) => item && item.thumb);
      const dynamicGoodsSrcs = dynamicGoods.map((item) => item.thumb);
      const hotShowcaseGoods = hotGoods.slice(0, HOME_SHOWCASE_CARD_LIMIT);
      const imgSrcs = Array.isArray(homeContent.imgSrcs)
        ? homeContent.imgSrcs.slice(0, 3)
        : [];
      const productHeroSrc = imgSrcs[0] || (hotGoods[0] && hotGoods[0].thumb) || '';
      this.setData({
        swiperGoods,
        dynamicGoods,
        dynamicGoodsSrcs,
        hotGoods,
        hotShowcaseGoods,
        newGoods,
        domesticGoods,
        lubricantGoods,
        toyGoods,
        lastingGoods,
        productHeroSrc,
        imgSrcs,
        pageLoading: false,
        homeLoaded: true,
      });
    } catch (err) {
      const message = getCloudErrorMessage(err, '首页内容加载失败，请稍后重试');
      this.setData({ pageLoading: false, homeLoaded: true });
      wx.showToast({ title: message, icon: 'none' });
    }
  },

  focusSearch() {
    if (!this.data.searchFocus) {
      this.setData({ searchFocus: true });
    }
  },

  handleSearchFocus() {
    this.setData({ searchFocus: true });
  },

  handleSearchBlur() {
    this.setData({ searchFocus: false });
  },

  handleSearchChange(event) {
    const { value = '' } = event.detail || {};
    this.setData({ searchValue: value });
  },

  async handleSearchSubmit(event) {
    const { value = '' } = event.detail || {};
    const keyword = String(value).trim();
    if (!keyword) return;

    this.setData({ searchValue: keyword });
    try {
      await addSearchHistory(keyword);
    } catch {
      // 搜索不因历史记录写入失败而中断
    }
    wx.navigateTo({
      url: `/pages/goods/result/index?searchValue=${encodeURIComponent(keyword)}`,
    });
  },

  navToGoodsDetail({ detail }) {
    const { index = 0 } = detail || {};
    const { spuId } = this.data.swiperGoods[index] || {};
    if (!spuId) return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  navToDynamicGoodsDetail({ detail }) {
    const { index = 0 } = detail || {};
    const { spuId } = this.data.dynamicGoods[index] || {};
    if (!spuId) return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  navToHotGoodsHeroDetail() {
    const { spuId } = this.data.hotGoods[0] || {};
    if (!spuId) return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  navToHotGoodsDetail({ currentTarget }) {
    const { spuId } = currentTarget.dataset || {};
    if (spuId === undefined || spuId === null || spuId === '') return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },
});
