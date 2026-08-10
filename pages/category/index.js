import { getCategoryList } from '../../services/good/fetchCategoryList';
Page({
  data: {
    list: [],
    statusBarHeight: 0,
    navBarHeight: 44,
    customNavHeight: 44,
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
  onChange() {
    wx.navigateTo({
      url: '/pages/goods/list/index',
    });
  },
  navToSearchPage() {
    wx.navigateTo({ url: '/pages/goods/search/index' });
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
    });
    this.init(true);
  },
});
