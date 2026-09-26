// @ts-nocheck

import { getCategoryList } from '../../services/good/fetchCategoryList';
import { fetchGoodsList } from '../../services/good/fetchGoodsList';
import { addSearchHistory } from '../../services/good/fetchSearchHistory';
import { getApiErrorMessage } from '../../utils/api';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

Page({
  data: {
    list: [], activeParentIndex: 0,
    goodsSections: [], goodsLoading: false, goodsError: '',
    categoryLoading: false, categoryError: '',
    statusBarHeight: 0, navBarHeight: 44, customNavHeight: 44, categoryHeight: 0,
    searchTop: 0, searchLeft: 0, searchWidth: 375, searchValue: '', searchFocus: false,
  },
  categoryRequestId: 0,
  goodsRequestId: 0,
  goodsPage: 1,
  goodsChildIndex: 0,
  async loadCategories() {
    const requestId = ++this.categoryRequestId;
    this.setData({ categoryLoading: true, categoryError: '' });
    try {
      const list = await getCategoryList();
      if (requestId !== this.categoryRequestId) return;
      const selectedParent = this.data.list[this.data.activeParentIndex];
      const parentIndex = Math.max(0, list.findIndex((item) => String(item._id || item.id) === String(selectedParent?._id || selectedParent?.id)));
      ++this.goodsRequestId;
      this.setData({ list, activeParentIndex: parentIndex, categoryLoading: false, categoryError: '' }, () => this.loadGoods(true));
    } catch (error) {
      if (requestId !== this.categoryRequestId) return;
      this.setData({ list: [], categoryLoading: false, categoryError: getApiErrorMessage(error, '分类加载失败，请稍后重试') });
    }
  },
  selectParent(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (index === this.data.activeParentIndex) return;
    ++this.goodsRequestId;
    this.setData({ activeParentIndex: index, goodsSections: [], goodsError: '' }, () => this.loadGoods(true));
  },
  async loadGoods(reset = false) {
    if (reset) {
      ++this.goodsRequestId;
      this.goodsChildIndex = 0;
      this.goodsPage = 1;
      this.setData({ goodsSections: [], goodsLoading: false, goodsError: '' }, () => void this.loadGoods(false));
      return;
    }
    if (this.data.goodsLoading) return;
    const children = this.data.list[this.data.activeParentIndex]?.children || [];
    if (!children.length || this.goodsChildIndex >= children.length) return;
    const requestId = this.goodsRequestId;
    let sections = [...this.data.goodsSections];
    this.setData({ goodsLoading: true, goodsError: '' });
    try {
      while (this.goodsChildIndex < children.length) {
        const childIndex = this.goodsChildIndex;
        const child = children[childIndex];
        if (!sections[childIndex]) {
          sections = [...sections, { id: String(child._id || child.id), name: child.name, image: child.image || '', goodsList: [], loaded: false }];
          this.setData({ goodsSections: sections });
        }
        const result = await fetchGoodsList({ categoryId: String(child._id || child.id), pageNum: this.goodsPage, pageSize: 100 });
        if (requestId !== this.goodsRequestId) return;
        const goodsList = [...sections[childIndex].goodsList, ...result.spuList];
        const loaded = goodsList.length >= result.totalCount || result.spuList.length === 0;
        sections = sections.map((section, index) => index === childIndex ? { ...section, goodsList, loaded } : section);
        this.setData({ goodsSections: sections });
        if (loaded) { this.goodsChildIndex += 1; this.goodsPage = 1; }
        else this.goodsPage += 1;
      }
      this.setData({ goodsLoading: false });
    } catch (error) {
      if (requestId !== this.goodsRequestId) return;
      this.setData({ goodsLoading: false, goodsError: getApiErrorMessage(error, '商品加载失败，请重试') });
    }
  },
  retryGoods() { void this.loadGoods(false); },
  openGoods(event) {
    const id = event.currentTarget.dataset.id;
    if (id) navigateToGoodsDetail(`/pages/goods/details/index?spuId=${encodeURIComponent(String(id))}`);
  },
  onShow() {
    this.getTabBar().init();
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
    wx.createSelectorQuery().select('.category-header').boundingClientRect((rect) => {
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
