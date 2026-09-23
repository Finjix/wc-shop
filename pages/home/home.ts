// @ts-nocheck

import { fetchHomeContent } from '../../services/good/fetchHomeContent';
import { addSearchHistory } from '../../services/good/fetchSearchHistory';
import { getApiErrorMessage } from '../../utils/api';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

const DEFAULT_BANNER_TEXT = '急速发货 | 品质保证 | 退货无忧';

Page({
  data: {
    swiperSlides: [],
    swiperProductIds: [],
    promos: [],
    featuredSections: [],
    bannerText: DEFAULT_BANNER_TEXT,
    pageLoading: false,
    current: 0,
    autoplay: true,
    duration: '500',
    interval: 2000,
    swiperImageProps: { mode: 'aspectFill', showMenuByLongpress: true },
    searchTop: 0,
    searchLeft: 0,
    searchWidth: 375,
    searchHeight: 32,
    searchRadius: 16,
    searchValue: '',
    searchFocus: false,
  },

  onShow() { this.getTabBar().init(); this.loadHomePage(); },

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
  },

  onPullDownRefresh() { this.loadHomePage(); },

  async loadHomePage() {
    wx.stopPullDownRefresh();
    this.setData({ pageLoading: true });
    try {
      const home = await fetchHomeContent();
      const config = home.config || {};
      const products = home.productsById || {};
      const legacyBanners = (home.items || []).filter((item) => item.type === 'banner');
      const banners = Array.isArray(config.banners) ? config.banners : legacyBanners.map((item) => ({ image: item.image || item.content, productId: item.payload?.productId || '' }));
      const slides = banners.slice(0, 6).flatMap((entry) => {
        const product = products[entry.productId];
        if (!entry.image || (entry.productId && !product)) return [];
        return [{
          image: entry.image,
          productId: product ? String(product.spuId || product._id) : '',
        }];
      });
      const promos = Array.from({ length: 2 }, (_, index) => {
        const entry = config.promos?.[index] || {};
        const product = products[entry.productId];
        if (!entry.image || !product) return null;
        return {
          id: index,
          image: entry.image,
          productId: String(product.spuId || product._id),
        };
      }).filter(Boolean);
      const featuredSections = Array.isArray(config.sections) && config.sections.length
        ? config.sections.map((section) => ({
          id: section.id,
          title: section.title || '',
          products: (section.productIds || []).flatMap((id, index) => {
            const product = products[id];
            const image = product?.thumb || product?.primaryImage;
            if (!image) return [];
            return [{
              id: `${section.id}-${index}`,
              image,
              productId: String(product.spuId || product._id),
            }];
          }),
        })).filter((section) => section.title && section.products.length)
        : [];
      this.setData({
        swiperSlides: slides.map((item) => item.image),
        swiperProductIds: slides.map((item) => item.productId),
        promos,
        featuredSections,
        bannerText: config.bannerText || DEFAULT_BANNER_TEXT,
        pageLoading: false,
      });
    } catch (error) {
      this.setData({ pageLoading: false });
      wx.showToast({ title: getApiErrorMessage(error, '首页内容加载失败，请稍后重试'), icon: 'none' });
    }
  },

  focusSearch() { if (!this.data.searchFocus) this.setData({ searchFocus: true }); },
  handleSearchFocus() { this.setData({ searchFocus: true }); },
  handleSearchBlur() { this.setData({ searchFocus: false }); },
  handleSearchChange(event) { this.setData({ searchValue: event.detail?.value || '' }); },

  async handleSearchSubmit(event) {
    const keyword = String(event.detail?.value || '').trim();
    if (!keyword) return;
    this.setData({ searchValue: keyword });
    try { await addSearchHistory(keyword); } catch { /* 搜索不因历史记录写入失败而中断 */ }
    wx.navigateTo({ url: `/pages/goods/result/index?searchValue=${encodeURIComponent(keyword)}` });
  },

  navToGoodsDetail({ detail }) {
    this.openProduct(this.data.swiperProductIds[detail?.index || 0]);
  },

  navToConfiguredProduct({ currentTarget }) {
    this.openProduct(currentTarget.dataset.productId);
  },

  openProduct(productId) {
    if (!productId) return;
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${encodeURIComponent(productId)}`);
  },
});
