// @ts-nocheck
Component({
  properties: { items: { type: Array, value: [] } },
  data: { mounted: true, height: 0 },
  observers: { items() { this.updateHeight(); } },
  lifetimes: {
    attached() { this.updateHeight(); },
    ready() {
      // Keep one screen of overscan; the fixed wrapper preserves scroll position.
      const info = wx.getWindowInfo();
      this.observer = this.createIntersectionObserver({ nativeMode: true }).relativeToViewport({ top: info.windowHeight, bottom: info.windowHeight });
      this.observer.observe('.feed-batch', ({ intersectionRatio }) => {
        const mounted = intersectionRatio > 0;
        if (mounted !== this.data.mounted) this.setData({ mounted });
      });
    },
    detached() { this.observer?.disconnect(); },
  },
  methods: {
    updateHeight() {
      const width = wx.getWindowInfo().windowWidth;
      const rows = Math.ceil(this.data.items.length / 2);
      const height = rows * (width - 64 * width / 750) * 2 / 3 + Math.max(0, rows - 1) * 16 * width / 750;
      if (height !== this.data.height) this.setData({ height });
    },
    navToConfiguredProduct({ currentTarget }) { this.triggerEvent('product', currentTarget.dataset); },
    addFeedProductToCart({ currentTarget }) { this.triggerEvent('cart', currentTarget.dataset); },
  },
});
