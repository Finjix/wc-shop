import Toast from 'tdesign-miniprogram/toast/index';
import { createComment } from '../../../../services/comments/createComment';
import { getCloudErrorMessage } from '../../../../utils/cloud';

Page({
  data: {
    goodRateValue: 4,
    uploadFiles: [],
    gridConfig: { width: 218, height: 218, column: 3 },
    isAllowedSubmit: false,
    imgUrl: '',
    title: '',
    goodsDetail: '',
    imageProps: { mode: 'aspectFit' },
    submitting: false,
  },

  onLoad(options = {}) {
    this.orderNo = options.orderNo || '';
    this.productId = options.productId || options.spuId || '';
    this.skuId = options.skuId || '';
    this.setData({ imgUrl: options.imgUrl, title: options.title, goodsDetail: options.specs });
  },

  onRateChange(e) {
    const { value } = e?.detail || {};
    const item = e?.currentTarget?.dataset?.item;
    this.setData({ [item]: value }, () => this.updateButtonStatus());
  },

  handleSuccess(e) {
    this.setData({ uploadFiles: (e.detail.files || []).filter((file) => file && file.type !== 'video') });
  },

  handleRemove(e) {
    const { index } = e.detail;
    const uploadFiles = this.data.uploadFiles.slice();
    uploadFiles.splice(index, 1);
    this.setData({ uploadFiles });
  },

  onTextAreaChange(e) {
    this.textAreaValue = e?.detail?.value || '';
    this.updateButtonStatus();
  },

  updateButtonStatus() {
    const isAllowedSubmit = Boolean(this.data.goodRateValue && (this.textAreaValue || '').trim());
    if (isAllowedSubmit !== this.data.isAllowedSubmit) this.setData({ isAllowedSubmit });
  },

  onSubmitBtnClick() {
    const { isAllowedSubmit, submitting, uploadFiles, goodRateValue } = this.data;
    if (!isAllowedSubmit || submitting || this.commentSubmitPromise) return;
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
      commentScore: goodRateValue,
      commentContent: (this.textAreaValue || '').trim(),
      commentResources: uploadFiles,
    }).then(() => {
      this.commentSubmitSucceeded = true;
      Toast({ context: this, selector: '#t-toast', message: '评价提交成功', icon: 'check-circle' });
      setTimeout(() => wx.navigateBack(), 600);
    }).catch((error) => {
      Toast({
        context: this,
        selector: '#t-toast',
        message: getCloudErrorMessage(error, '评价提交失败，请稍后重试'),
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
