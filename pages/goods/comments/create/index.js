import Toast from 'tdesign-miniprogram/toast/index';
Page({
  data: {
    goodRateValue: 4,
    uploadFiles: [],
    gridConfig: {
      width: 218,
      height: 218,
      column: 3,
    },
    isAllowedSubmit: false,
    imgUrl: '',
    title: '',
    goodsDetail: '',
    imageProps: {
      mode: 'aspectFit',
    },
  },

  onLoad(options) {
    this.setData({
      imgUrl: options.imgUrl,
      title: options.title,
      goodsDetail: options.specs,
    });
  },

  onRateChange(e) {
    const { value } = e?.detail;
    const item = e?.currentTarget?.dataset?.item;
    this.setData({ [item]: value }, () => {
      this.updateButtonStatus();
    });
  },

  handleSuccess(e) {
    const { files } = e.detail;

    this.setData({
      uploadFiles: files,
    });
  },

  handleRemove(e) {
    const { index } = e.detail;
    const { uploadFiles } = this.data;
    uploadFiles.splice(index, 1);
    this.setData({
      uploadFiles,
    });
  },

  onTextAreaChange(e) {
    const value = e?.detail?.value;
    this.textAreaValue = value;
    this.updateButtonStatus();
  },

  updateButtonStatus() {
    const { goodRateValue, isAllowedSubmit } = this.data;
    const { textAreaValue } = this;
    const temp = goodRateValue && textAreaValue;
    if (temp !== isAllowedSubmit) this.setData({ isAllowedSubmit: temp });
  },

  onSubmitBtnClick() {
    const { isAllowedSubmit } = this.data;
    if (!isAllowedSubmit) return;
    Toast({
      context: this,
      selector: '#t-toast',
      message: '评价提交成功',
      icon: 'check-circle',
    });
    wx.navigateBack();
  },
});
