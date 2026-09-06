import { getCategoryList } from '../../services/good/fetchCategoryList';
import { addSearchHistory } from '../../services/good/fetchSearchHistory';
import { getApiErrorMessage } from '../../utils/api';

Page({
  data: {
    list: [],
    categoryLoading: false,
    categoryLoaded: false,
    categoryError: '',
    categoryUnavailable: false,
    statusBarHeight: 0,
    navBarHeight: 44,
    customNavHeight: 44,
    categoryHeight: 0,
    searchTop: 0,
    searchLeft: 0,
    searchWidth: 375,
    searchValue: '',
    searchFocus: false,
  },
  async init() {
    this.setData({ categoryLoading: true, categoryError: '' });
    try {
      const result = await getCategoryList();
      this.setData({
        list: result,
        categoryLoading: false,
        categoryLoaded: true,
        categoryUnavailable: false,
        categoryError: result.length ? '' : '暂无分类内容',
      });
    } catch (error) {
      if (error && error.code === 'API_UNAVAILABLE') {
        this.setData({
          list: [],
          categoryLoading: false,
          categoryLoaded: true,
          categoryError: '',
          categoryUnavailable: true,
        });
        return;
      }
      const message = getApiErrorMessage(error, '分类加载失败，请稍后重试');
      this.setData({
        list: [],
        categoryLoading: false,
        categoryLoaded: true,
        categoryError: message,
        categoryUnavailable: false,
      });
      wx.showToast({ title: message, icon: 'none' });
    }
  },

  onShow() {
    this.getTabBar().init();
  },
  onChange(event) {
    const item = event && event.detail ? event.detail.item : null;
    const categoryName = item && item.name ? encodeURIComponent(item.name) : '';
    const categoryId = item && item.groupId ? encodeURIComponent(item.groupId) : '';
    wx.navigateTo({
      url: categoryName
        ? `/pages/goods/list/index?categoryName=${categoryName}&categoryId=${categoryId}`
        : '/pages/goods/list/index',
    });
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
  updateCategoryHeight() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const tabBarHeight = (96 * (windowInfo.windowWidth || 375)) / 750;
    wx.createSelectorQuery()
      .select('.category-header')
      .boundingClientRect((rect) => {
        if (!rect || !rect.height) return;
        const categoryHeight = Math.max(windowInfo.windowHeight - rect.height - tabBarHeight, 0);
        if (categoryHeight !== this.data.categoryHeight) {
          this.setData({ categoryHeight });
        }
      })
      .exec();
  },
  onReady() {
    this.updateCategoryHeight();
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const windowWidth = windowInfo.windowWidth || 375;
    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const navBarHeight = menuButtonInfo.height
      ? menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2
      : 44;
    const customNavHeight = statusBarHeight + navBarHeight;
    const screenSideGap = Math.max(windowWidth - (menuButtonInfo.right || windowWidth), 0);
    const menuButtonLeft = menuButtonInfo.left || windowWidth;
    const tabBarHeight = (96 * windowWidth) / 750;

    this.setData({
      statusBarHeight,
      navBarHeight,
      customNavHeight,
      searchTop: menuButtonInfo.top || 0,
      searchLeft: screenSideGap,
      searchWidth: Math.max(menuButtonLeft - screenSideGap * 2, 0),
      categoryHeight: Math.max(
        windowInfo.windowHeight -
          customNavHeight -
          tabBarHeight,
        0,
      ),
    }, () => this.updateCategoryHeight());
    this.init(true);
  },
});
