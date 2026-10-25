// @ts-nocheck

import { fetchHomeContent, fetchHomeFeed } from '../../common/services/good/fetchHomeContent';
import { addSearchHistory } from '../../common/services/good/fetchSearchHistory';
import { getApiErrorMessage } from '../../common/services/utils/api';
import { navigateToGoodsDetail } from '../../common/utils/goods-detail-navigation';
import { shopShareHandlers, enablePageSharing } from '../../common/share';

Page({
  ...shopShareHandlers,
  data: {
    swiperSlides: [],
    swiperProductIds: [],
    recommendations: [],
    recommendationCurrent: 0,
    heartTitle: ['倾', '心', '推', '荐'],
    giftTitle: ['更', '多', '献', '礼'],
    feedItems: [],
    feedLoading: false,
    feedEmpty: false,
    feedError: '',
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

  onShow() {
    enablePageSharing();
    this.getTabBar()?.init();
    this.visible = true;
    if (!this.homeRequested) this.loadHomePage();
    this.startRecommendationTimer();
  },

  onHide() { this.visible = false; this.stopRecommendationTimer(); },
  onUnload() {
    this.visible = false;
    this.stopRecommendationTimer();
    this.loadVersion = (this.loadVersion || 0) + 1;
    this.feedRequestId = (this.feedRequestId || 0) + 1;
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
  },

  onPullDownRefresh() { this.loadHomePage(); },

  async loadHomePage() {
    this.homeRequested = true;
    const version = this.loadVersion = (this.loadVersion || 0) + 1;
    this.stopRecommendationTimer();
    this.feedRequestId = (this.feedRequestId || 0) + 1;
    this.feedCursor = '';
    this.feedActivated = false;
    this.feedScrollTop = 0;
    this.feedTouchStartY = null;
    this.setData({ pageLoading: true, loadError: '', feedItems: [],
      feedEmpty: false, feedLoading: false, feedError: '' });
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
      const recommendations = (config.recommendations || []).slice(0, 4).flatMap((entry) => {
        const product = products[entry.productId];
        if (!entry.image || !product) return [];
        return [{ image: entry.image, title: product.title || '', productId: String(product._id) }];
      });
      this.setData({
        swiperSlides: slides.map((item) => item.image),
        swiperProductIds: slides.map((item) => item.productId),
        recommendations,
        recommendationCurrent: 0,
        pageLoading: false,
        loadError: '',
      });
      this.startRecommendationTimer();
    } catch (error) {
      if (this.loadVersion !== version) return;
      const loadError = getApiErrorMessage(error, '首页内容加载失败，请稍后重试');
      this.setData({ pageLoading: false, loadError });
      wx.showToast({ title: loadError, icon: 'none' });
    } finally {
      if (this.loadVersion === version) wx.stopPullDownRefresh();
    }
  },

  startRecommendationTimer() {
    this.stopRecommendationTimer();
    if (!this.visible || this.data.recommendations.length < 2) return;
    this.recommendationTimer = setInterval(() => {
      this.setData({ recommendationCurrent: (this.data.recommendationCurrent + 1) % this.data.recommendations.length });
    }, 2500);
  },

  stopRecommendationTimer() {
    if (this.recommendationTimer) clearInterval(this.recommendationTimer);
    this.recommendationTimer = null;
  },

  onRecommendationChange({ detail }) {
    this.setData({ recommendationCurrent: detail.current });
    if (detail.source === 'touch') this.startRecommendationTimer();
  },

  async loadMoreFeed() {
    if (!this.feedActivated || this.data.feedLoading || this.data.feedEmpty) return;
    const requestId = this.feedRequestId = (this.feedRequestId || 0) + 1;
    this.setData({ feedLoading: true, feedError: '' });
    try {
      const result = await fetchHomeFeed({ limit: 6, cursor: this.feedCursor || '' });
      if (requestId !== this.feedRequestId) return;
      this.feedCursor = result.nextCursor || '';
      const update = { feedLoading: false, feedEmpty: !result.items.length };
      const offset = this.data.feedItems.length;
      result.items.forEach((item, index) => { update[`feedItems[${offset + index}]`] = item; });
      this.setData(update);
    } catch (error) {
      if (requestId !== this.feedRequestId) return;
      this.setData({ feedLoading: false, feedError: getApiErrorMessage(error, '商品加载失败，点击重试') });
    }
  },

  activateFeed() {
    if (this.feedActivated) return;
    this.feedActivated = true;
    this.loadMoreFeed();
  },

  onFeedScroll({ detail }) {
    const top = Math.max(0, Number(detail.scrollTop) || 0);
    if (top > (this.feedScrollTop || 0)) this.activateFeed();
    this.feedScrollTop = top;
  },

  onFeedTouchStart(event) {
    this.feedTouchStartY = event.touches?.[0]?.clientY ?? null;
    this.feedTouchStartX = Number(event.touches?.[0]?.clientX) || 0;
  },

  onFeedTouchMove(event) {
    const y = event.touches?.[0]?.clientY;
    const distanceX = Math.abs((Number(event.touches?.[0]?.clientX) || 0) - this.feedTouchStartX);
    // A swipe can start the feed even when the initial content is too short to scroll.
    if (this.feedTouchStartY !== null && typeof y === 'number'
      && this.feedTouchStartY - y > Math.max(8, distanceX)) this.activateFeed();
  },

  onFeedBottom() {
    if (this.feedActivated && !this.data.feedError) this.loadMoreFeed();
  },

  addFeedProductToCart({ currentTarget }) {
    const productId = currentTarget.dataset.productId;
    if (productId) navigateToGoodsDetail(`/goods/details/index?spuId=${encodeURIComponent(productId)}&skuAction=addCart`);
  },

  showInviteComingSoon() { wx.showToast({ title: '敬请期待！', icon: 'none' }); },

  focusSearch() { if (!this.data.searchFocus) this.setData({ searchFocus: true }); },
  handleSearchFocus() { this.setData({ searchFocus: true }); },
  handleSearchBlur() { this.setData({ searchFocus: false }); },
  handleSearchChange(event) { this.setData({ searchValue: event.detail?.value || '' }); },

  async handleSearchSubmit(event) {
    const keyword = String(event.detail?.value || '').trim();
    if (!keyword) return;
    this.setData({ searchValue: keyword });
    try { await addSearchHistory(keyword); } catch { /* 搜索不因历史记录写入失败而中断 */ }
    wx.navigateTo({ url: `/goods/result/index?searchValue=${encodeURIComponent(keyword)}` });
  },

  navToGoodsDetail({ detail }) {
    this.openProduct(this.data.swiperProductIds[detail?.index || 0]);
  },

  navToConfiguredProduct({ currentTarget }) {
    this.openProduct(currentTarget.dataset.productId);
  },

  openProduct(productId) {
    if (!productId) return;
    navigateToGoodsDetail(`/goods/details/index?spuId=${encodeURIComponent(productId)}`);
  },
});
