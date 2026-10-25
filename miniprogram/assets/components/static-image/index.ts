// @ts-nocheck
// Images stay inside their owning package; main pages reference this component asynchronously.
Component({
  options: { virtualHost: true },
  data: { framesReady: false, framesPlaying: false },
  properties: {
    asset: { type: String, value: '' },
    size: { type: String, value: '100%' },
  },
  lifetimes: {
    attached() { this.pageVisible = true; },
    ready() {
      if (!['invite-cashback', 'customer-gift'].includes(this.data.asset)) return;
      try {
        this.visibilityObserver = this.createIntersectionObserver({ thresholds: [0, 0.01] }).relativeToViewport();
        this.visibilityObserver.observe('.promo-frame-window', ({ intersectionRatio }) => {
          if (this.disposed) return;
          this.inViewport = intersectionRatio > 0;
          this.updateFramePlayback();
        });
      } catch { this.onFrameError(); }
    },
    detached() { this.disposed = true; this.visibilityObserver?.disconnect(); },
  },
  pageLifetimes: {
    show() { this.pageVisible = true; this.updateFramePlayback(); },
    hide() { this.pageVisible = false; this.updateFramePlayback(); },
  },
  methods: {
    onFrameLoad() {
      if (this.disposed || this.failed) return;
      this.setData({ framesReady: true });
      this.updateFramePlayback();
    },
    onFrameError() {
      this.failed = true;
      this.visibilityObserver?.disconnect();
      if (!this.disposed) this.setData({ framesReady: false, framesPlaying: false });
    },
    updateFramePlayback() {
      if (this.disposed) return;
      const framesPlaying = !!(this.data.framesReady && this.pageVisible && this.inViewport && !this.failed);
      if (this.data.framesPlaying !== framesPlaying) this.setData({ framesPlaying });
    },
  },
});
