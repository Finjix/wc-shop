// @ts-nocheck

import { getCategoryList } from '../../common/services/good/fetchCategoryList';
import { addSearchHistory } from '../../common/services/good/fetchSearchHistory';
import { getApiErrorMessage } from '../../common/services/utils/api';
import { shopShareHandlers, enablePageSharing } from '../../common/share';

Page({
  ...shopShareHandlers,
  data: {
    list: [], activeParentIndex: 0,
    categorySections: [], categoryScrollTop: 0,
    categoryLoading: false, categoryError: '',
    statusBarHeight: 0, navBarHeight: 44, customNavHeight: 44, categoryHeight: 0,
    searchTop: 0, searchLeft: 0, searchWidth: 375, searchValue: '', searchFocus: false,
  },
  categoryRequestId: 0,
  async loadCategories() {
    const requestId = ++this.categoryRequestId;
    this.setData({ categoryLoading: true, categoryError: '' });
    try {
      const list = await getCategoryList();
      if (requestId !== this.categoryRequestId) return;
      const selectedParent = this.data.list[this.data.activeParentIndex];
      const parentIndex = Math.max(0, list.findIndex((item) => String(item._id || item.id) === String(selectedParent?._id || selectedParent?.id)));
      this.setData({ list, activeParentIndex: parentIndex, categorySections: list[parentIndex]?.children || [], categoryLoading: false, categoryError: '' });
    } catch (error) {
      if (requestId !== this.categoryRequestId) return;
      this.setData({ list: [], categorySections: [], categoryLoading: false, categoryError: getApiErrorMessage(error, '分类加载失败，请稍后重试') });
    }
  },
  handleCategoryScroll(event) { this.setData({ categoryScrollTop: event.detail.scrollTop }); },
  selectParent(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (index === this.data.activeParentIndex) return;
    if (!this.data.list[index]) return;
    this.setData({ activeParentIndex: index, categorySections: this.data.list[index].children || [], categoryScrollTop: 0 });
  },
  retryCategories() { void this.loadCategories(); },
  onUnload() { ++this.categoryRequestId; },
  openCategoryResults(event) {
    const { categoryId, categoryName } = event.currentTarget.dataset;
    if (!categoryId) return;
    wx.navigateTo({ url: `/pages/goods/result/index?categoryId=${encodeURIComponent(String(categoryId))}&categoryName=${encodeURIComponent(categoryName || '')}` });
  },
  onShow() {
    enablePageSharing();
    this.getTabBar()?.init();

    void this.loadCategories();
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
  updateCategoryHeight() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const tabBarHeight = (96 * (windowInfo.windowWidth || 375)) / 750;
    this.createSelectorQuery().select('.category-header').boundingClientRect((rect) => {
      if (!rect?.height) return;
      const height = Math.max(windowInfo.windowHeight - rect.height - tabBarHeight, 0);
      if (height !== this.data.categoryHeight) this.setData({ categoryHeight: height });
    }).exec();
  },
  onReady() { this.updateCategoryHeight(); },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const windowWidth = windowInfo.windowWidth || 375;
    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const navBarHeight = menuButtonInfo.height ? menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2 : 44;
    const customNavHeight = statusBarHeight + navBarHeight;
    const screenSideGap = Math.max(windowWidth - (menuButtonInfo.right || windowWidth), 0);
    const menuButtonLeft = menuButtonInfo.left || windowWidth;
    const tabBarHeight = (96 * windowWidth) / 750;
    this.setData({
      statusBarHeight, navBarHeight, customNavHeight,
      searchTop: menuButtonInfo.top || 0, searchLeft: screenSideGap,
      searchWidth: Math.max(menuButtonLeft - screenSideGap * 2, 0),
      categoryHeight: Math.max(windowInfo.windowHeight - customNavHeight - tabBarHeight, 0),
    }, () => this.updateCategoryHeight());
  },
});
