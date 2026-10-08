// @ts-nocheck

import { fetchHomeContent } from '../../services/good/fetchHomeContent';
import { addSearchHistory } from '../../services/good/fetchSearchHistory';
import { getApiErrorMessage } from '../../utils/api';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

Page({
  data: {
    swiperSlides: [],
    swiperProductIds: [],
    promos: [],
    featuredSections: [],
    bannerText: '',
    pageLoading: false,
    loadError: '',
    current: 0,
    autoplay: true,
    duration: '500',
    interval: 2500,
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
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    this.setData({ pageLoading: true, loadError: '' });
    try {
      const home = await fetchHomeContent();
      if (this.loadVersion !== version) return;
      const config = home.config || {};
      const products = home.productsById || {};
      const banners = config.banners || [];
      const slides = banners.slice(0, 4).flatMap((entry) => {
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
        if (!entry.image || (entry.productId && !product)) return null;
        return {
          id: index,
          image: entry.image,
          productId: product ? String(product.spuId || product._id) : '',
        };
      }).filter(Boolean);
      const featuredSections = Array.isArray(config.sections) && config.sections.length
        ? config.sections.slice(0, 4).map((section) => ({
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
        bannerText: config.bannerText || '',
        pageLoading: false,
        loadError: '',
      });
    } catch (error) {
      if (this.loadVersion !== version) return;
      const loadError = getApiErrorMessage(error, '首页内容加载失败，请稍后重试');
      this.setData({ pageLoading: false, loadError });
      wx.showToast({ title: loadError, icon: 'none' });
    } finally {
      if (this.loadVersion === version) wx.stopPullDownRefresh();
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
