// @ts-nocheck

import Toast from '../../components/tdesign/toast/index';
import { create, update } from './api';
import { getApiErrorMessage } from '../../common/services/utils/api';

Page({
  data: {
    trackingNo: '',
    submitActived: false,
    submitting: false,
  },

  onLoad(query = {}) {
    this.rightsNo = query.rightsNo || '';
    if (!this.rightsNo) {
      wx.showToast({ title: '售后单不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.isChange = Boolean(query.logisticsNo);
    this.setData({
      trackingNo: query.logisticsNo || '',
      submitActived: Boolean((query.logisticsNo || '').trim()),
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = String(e.detail.value || '');
    this.setData({ [key]: value }, () => this.checkParams());
  },

  checkParams() {
    const valid = Boolean((this.data.trackingNo || '').trim());
    this.setData({ submitActived: valid });
    return valid;
  },

  onSubmit() {
    if (this.data.submitting || this.trackingSubmitPromise) return;
    if (!this.checkParams()) {
      Toast({ context: this, selector: '#t-toast', message: '请填写运单号', icon: '' });
      return;
    }
    const params = {
      afterSaleId: this.rightsNo,
      rightsNo: this.rightsNo,
      trackingNo: String(this.data.trackingNo).trim(),
      logisticsNo: String(this.data.trackingNo).trim(),
    };
    const submit = this.isChange ? update : create;
    this.setData({ submitting: true });
    this.trackingSubmitPromise = submit(params)
      .then(() => {
        this.setData({ submitting: false });
        Toast({ context: this, selector: '#t-toast', message: '退货物流已提交', icon: 'check-circle' });
        const pages = getCurrentPages();
        const previousPage = pages[pages.length - 2];
        if (previousPage) previousPage.data.backRefresh = true;
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((error) => {
        this.setData({ submitting: false });
        Toast({
          context: this,
          selector: '#t-toast',
          message: getApiErrorMessage(error, '物流信息保存失败，请稍后重试'),
          icon: '',
        });
      })
      .finally(() => { this.trackingSubmitPromise = null; });
    return this.trackingSubmitPromise;
  },

});
