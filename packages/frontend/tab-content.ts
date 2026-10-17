// @ts-nocheck
/** Adapt a former Page definition into a component without losing page lifecycle order. */
export function tabContent(definition) {
  const { data, onLoad, onReady, onShow, onHide, onUnload, onPullDownRefresh, onReachBottom, onPageScroll, onResize, ...members } = definition;
  const methods = {};
  const fields = {};
  for (const [key, value] of Object.entries(members)) {
    if (typeof value === 'function') methods[key] = value;
    else fields[key] = value;
  }
  return {
    options: { styleIsolation: 'shared', virtualHost: true },
    data,
    lifetimes: {
      attached() {
        Object.assign(this, fields);
        this.contentLoaded = false;
        this.contentVisible = false;
        this.contentClosed = false;
      },
      ready() { this.triggerEvent('contentready'); },
      detached() { this.unloadContent(); },
    },
    methods: {
      ...methods,
      loadContent(options) { if (!this.contentLoaded && !this.contentClosed) { this.contentLoaded = true; onLoad?.call(this, options); } },
      readyContent() { if (!this.contentClosed) onReady?.call(this); },
      showContent() { if (!this.contentVisible && !this.contentClosed) { this.contentVisible = true; onShow?.call(this); } },
      hideContent() { if (this.contentVisible) { this.contentVisible = false; onHide?.call(this); } },
      unloadContent() { if (!this.contentClosed) { this.hideContent(); this.contentClosed = true; onUnload?.call(this); } },
      pullDownContent() { return onPullDownRefresh ? onPullDownRefresh.call(this) : wx.stopPullDownRefresh(); },
      reachBottomContent() { return onReachBottom?.call(this); },
      scrollContent(event) { return onPageScroll?.call(this, event); },
      resizeContent(event) { return onResize?.call(this, event); },
    },
  };
}
