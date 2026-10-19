// @ts-nocheck
Component({
  data: { visible: false, src: '' },
  methods: {
    open(src, fail) {
      this.onFailure = fail;
      this.setData({ visible: true, src });
    },
    close() { this.setData({ visible: false, src: '' }); this.onFailure = undefined; },
    onImageError() {
      const fail = this.onFailure;
      this.close();
      if (fail) fail({ errMsg: 'previewImage:fail image load error' });
      else wx.showToast({ title: '图片预览失败，请重试', icon: 'none' });
    },
    preventScroll() {},
  },
});
