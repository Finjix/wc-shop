import { fetchHomeContent } from '../../services/good/fetchHomeContent';
import { getCloudErrorMessage } from '../../utils/cloud';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

const HOME_GOODS_LIMIT = 6;
const HOME_SHOWCASE_CARD_LIMIT = 8;
const SEARCH_NAVIGATION_DISABLED = true;
const HOME_TEST_IMAGE = '/assets/home-test-image.jpg';
const HOME_SHOWCASE_PLACEHOLDER_CARDS = Array.from(
  { length: HOME_SHOWCASE_CARD_LIMIT },
  (_, index) => index,
);

function buildShowcaseGoods(goods) {
  const showcaseGoods = goods.slice(0, HOME_SHOWCASE_CARD_LIMIT);
  while (showcaseGoods.length < HOME_SHOWCASE_CARD_LIMIT) {
    showcaseGoods.push({});
  }
  return showcaseGoods;
}

Page({
  data: {
    imgSrcs: [],
    testImageSrc: HOME_TEST_IMAGE,
    placeholderShowcaseCards: HOME_SHOWCASE_PLACEHOLDER_CARDS,
    placeholderSlides: [HOME_TEST_IMAGE, HOME_TEST_IMAGE, HOME_TEST_IMAGE],
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
    placeholderSwiperImageProps: {
      mode: 'aspectFill',
      error: '测试图片',
      customStyle: 'background: #D9D9D9; color: #777; --td-image-loading-bg-color: #D9D9D9; --td-image-round-radius: 0;',
      showMenuByLongpress: true,
    },
    placeholderFeaturedSwiperImageProps: {
      mode: 'aspectFill',
      shape: 'round',
      error: '测试图片',
      customStyle: 'border-radius: 48rpx; overflow: hidden; background: #D9D9D9; color: #777; --td-image-round-radius: 48rpx; --td-image-loading-bg-color: #D9D9D9;',
      showMenuByLongpress: true,
    },
    searchTop: 0,
    searchLeft: 0,
    searchWidth: 375,
    searchHeight: 32,
    searchRadius: 16,
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
      const hotShowcaseGoods = buildShowcaseGoods(hotGoods);
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

  navToSearchPage() {
    if (SEARCH_NAVIGATION_DISABLED) return;
    wx.navigateTo({ url: '/pages/goods/search/index' });
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
