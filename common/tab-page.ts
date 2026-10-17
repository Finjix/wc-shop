// @ts-nocheck
import { loadFrontend } from './package-loader';

export function createTabPage() {
  return {
    data: { mountContent: false, contentReady: false, packageError: '' },
    onLoad(options) {
      this.pageOptions = options;
      this.closed = false;
      this.visible = false;
      this.content = null;
      this.pendingRefresh = new Map();
      this.retryPackage();
    },
    onShow() {
      this.visible = true;
      this.getTabBar()?.init();
      this.content?.showContent();
    },
    onHide() { this.visible = false; this.content?.hideContent(); },
    onUnload() { this.closed = true; this.content?.unloadContent(); this.content = null; },
    async retryPackage() {
      if (this.packageLoading || this.closed) return;
      this.packageLoading = true;
      this.setData({ packageError: '' });
      try {
        await loadFrontend();
        if (!this.closed) this.setData({ mountContent: true });
      } catch (error) {
        if (!this.closed) this.setData({ packageError: '界面加载失败，请重试' });
        console.error('Frontend package failed to load', error);
      } finally { this.packageLoading = false; }
    },
    onContentReady(event) {
      if (this.closed || this.content) return;
      const content = this.selectComponent('#tab-content');
      if (!content) return;
      this.content = content;
      content.loadContent(this.pageOptions);
      if (this.visible) content.showContent();
      content.readyContent();
      this.setData({ contentReady: true });
      for (const [name, args] of this.pendingRefresh) content[name]?.(...args);
      this.pendingRefresh.clear();
    },
    forward(name, args) {
      if (this.closed) return;
      if (this.content) return this.content[name]?.(...args);
      this.pendingRefresh.set(name, args);
    },
    refreshData(...args) { return this.forward('refreshData', args); },
    refreshOrderCounts(...args) { return this.forward('refreshOrderCounts', args); },
    onPullDownRefresh() { if (this.content) this.content.pullDownContent(); else wx.stopPullDownRefresh(); },
    onReachBottom() { this.content?.reachBottomContent(); },
    onPageScroll(event) { this.content?.scrollContent(event); },
    onResize(event) { this.content?.resizeContent(event); },
  };
}
