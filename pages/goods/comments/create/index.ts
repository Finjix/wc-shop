// @ts-nocheck

import Toast from 'tdesign-miniprogram/toast/index';
import { createComment } from '../../services/comments/createComment';
import { getApiErrorMessage } from '../../../../utils/api';
import { resolveImage } from '../../../../utils/images';

function decodeQueryValue(value) {
  const text = value == null ? '' : String(value);
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

Page({
  data: {
    uploadFiles: [],
    gridConfig: { width: 330, height: 330, column: 2 },
    isAllowedSubmit: false,
    imgUrl: '',
    title: '',
    goodsDetail: '',
    imageProps: { mode: 'aspectFit' },
    submitting: false,
    processingImages: false,
  },

  onLoad(options = {}) {
    this.orderNo = options.orderNo || '';
    this.productId = options.productId || options.spuId || '';
    this.skuId = options.skuId || '';
    this.setData({
      imgUrl: '',
      title: decodeQueryValue(options.title),
      goodsDetail: decodeQueryValue(options.specs),
    });
    resolveImage(decodeQueryValue(options.imgUrl)).then((imgUrl) => this.setData({ imgUrl }));
  },

  async handleSuccess(e) {
    if (this.data.processingImages || this.data.submitting) return;
    this.setData({ processingImages: true });
    wx.showLoading({ title: '处理图片中', mask: true });
    try {
      const processor = this.selectComponent('#image-processor');
      if (!processor?.prepare) throw new Error('图片组件加载中，请稍后重新选择');
      const result = await processor.prepare(e.detail.files || [], 50);
      this.setData({ uploadFiles: result.files }, () => this.updateButtonStatus());
      if (result.error) Toast({ context: this, selector: '#t-toast', message: result.error, icon: '' });
    } catch (error) {
      Toast({ context: this, selector: '#t-toast', message: error.message || '图片处理失败', icon: '' });
    } finally {
      wx.hideLoading();
      this.setData({ processingImages: false });
    }
  },

  handleRemove(e) {
    const { index } = e.detail;
    const uploadFiles = this.data.uploadFiles.slice();
    uploadFiles.splice(index, 1);
    this.setData({ uploadFiles }, () => this.updateButtonStatus());
  },

  onTextAreaChange(e) {
    this.textAreaValue = e?.detail?.value || '';
    this.updateButtonStatus();
  },

  updateButtonStatus() {
    const isAllowedSubmit = Boolean(
      (this.textAreaValue || '').trim() || this.data.uploadFiles.length,
    );
    if (isAllowedSubmit !== this.data.isAllowedSubmit) this.setData({ isAllowedSubmit });
  },

  onSubmitBtnClick() {
    const { isAllowedSubmit, submitting, uploadFiles } = this.data;
    if (!isAllowedSubmit || submitting || this.data.processingImages || this.commentSubmitPromise) return;
    if (this.commentSubmitBlockedUntil && Date.now() < this.commentSubmitBlockedUntil) return;
    if (!this.orderNo) {
      Toast({ context: this, selector: '#t-toast', message: '订单不存在，无法提交评价', icon: '' });
      return;
    }
    this.commentSubmitBlockedUntil = Date.now() + 2000;
    this.setData({ submitting: true });
    this.commentSubmitPromise = createComment({
      orderNo: this.orderNo,
      orderId: this.orderNo,
      productId: this.productId,
      spuId: this.productId,
      skuId: this.skuId,
      commentContent: (this.textAreaValue || '').trim(),
      commentResources: uploadFiles,
    }).then(() => {
      this.commentSubmitSucceeded = true;
      Toast({ context: this, selector: '#t-toast', message: '评价提交成功', icon: 'check-circle' });
      const pages = getCurrentPages();
      const previousPage = pages[pages.length - 2];
      if (previousPage) previousPage.data.backRefresh = true;
      setTimeout(() => wx.navigateBack(), 600);
    }).catch((error) => {
      Toast({
        context: this,
        selector: '#t-toast',
        message: getApiErrorMessage(error, '评价提交失败，请稍后重试'),
        icon: '',
      });
      this.commentSubmitBlockedUntil = Date.now() + 1000;
      this.setData({ submitting: false });
    }).finally(() => {
      if (!this.commentSubmitSucceeded) this.commentSubmitPromise = null;
      this.setData({ submitting: false });
    });
  },
});
// @ts-nocheck
