import { getCategoryList } from '../../services/good/fetchCategoryList';
Page({
  data: {
    list: [],
    statusBarHeight: 0,
    navBarHeight: 44,
    customNavHeight: 44,
    categoryHeight: 0,
  },
  async init() {
    try {
      const result = await getCategoryList();
      this.setData({
        list: result,
      });
    } catch (error) {
      console.error('err:', error);
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
  navToSearchPage() {
    wx.navigateTo({ url: '/pages/goods/search/index' });
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
    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const navBarHeight = menuButtonInfo.height
      ? menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2
      : 44;

    this.setData({
      statusBarHeight,
      navBarHeight,
      customNavHeight: statusBarHeight + navBarHeight,
      categoryHeight: Math.max(
        windowInfo.windowHeight -
          statusBarHeight -
          navBarHeight -
          (96 * (windowInfo.windowWidth || 375) * 2) / 750,
        0,
      ),
    }, () => this.updateCategoryHeight());
    this.init(true);
  },
});
