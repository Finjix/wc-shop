import Dialog from 'tdesign-miniprogram/dialog/index';
import Toast from 'tdesign-miniprogram/toast/index';
import reasonSheet from '../components/reason-sheet/reasonSheet';
import { getDeliverCompanyList, create, update } from './api';
import { getCloudErrorMessage } from '../../../utils/cloud';

Page({
  deliveryCompanyList: [],

  data: {
    trackingNo: '',
    remark: '',
    deliveryCompany: null,
    submitActived: false,
    submitting: false,
  },
  onLoad(query) {
    const {
      rightsNo = '',
      logisticsNo = '',
      logisticsCompanyName = '',
      logisticsCompanyCode = '',
      remark = '',
    } = query;

    if (!rightsNo) {
      Dialog.confirm({
        title: '请选择售后单？',
        content: '',
        confirmBtn: '确认',
      }).then(() => {
        wx.navigateBack({ backRefresh: true });
      });
      return;
    }
    this.rightsNo = rightsNo;
    if (logisticsNo) {
      wx.setNavigationBarTitle({
        title: '修改运单号',
        fail() {},
      });
      this.isChange = true;
      this.setData({
        deliveryCompany: {
          name: logisticsCompanyName,
          code: logisticsCompanyCode,
        },
        trackingNo: logisticsNo,
        remark,
        submitActived: true,
      });
    }
    this.setWatcher('trackingNo', this.checkParams.bind(this));
    this.setWatcher('deliveryCompany', this.checkParams.bind(this));
  },

  setWatcher(key, callback) {
    let lastData = this.data;
    const keys = key.split('.');
    keys.slice(0, -1).forEach((k) => {
      lastData = lastData[k];
    });
    const lastKey = keys[keys.length - 1];
    this.observe(lastData, lastKey, callback);
  },

  observe(data, k, callback) {
    let val = data[k];
    Object.defineProperty(data, k, {
      configurable: true,
      enumerable: true,
      set: (value) => {
        val = value;
        callback();
      },
      get: () => {
        return val;
      },
    });
  },

  getDeliveryCompanyList() {
    if (this.deliveryCompanyList.length > 0) {
      return Promise.resolve(this.deliveryCompanyList);
    }
    return getDeliverCompanyList(this.rightsNo).then((res) => {
      this.deliveryCompanyList = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
      return this.deliveryCompanyList;
    });
  },

  onInput(e) {
    const { key } = e.currentTarget.dataset;
    const { value } = e.detail;
    this.setData({ [key]: value });
  },

  onCompanyTap() {
    this.getDeliveryCompanyList().then((deliveryCompanyList) => {
      if (!deliveryCompanyList.length) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '云端暂无可选物流公司，请稍后重试',
          icon: '',
        });
        return;
      }
      reasonSheet({
        show: true,
        title: '选择物流公司',
        options: deliveryCompanyList.map((company) => ({
          title: company.name,
          checked: this.data.deliveryCompany
            ? company.code === this.data.deliveryCompany.code
            : false,
        })),
        showConfirmButton: true,
        showCancelButton: true,
        emptyTip: '请选择物流公司',
      }).then((indexes) => {
        if (!indexes || indexes[0] === undefined) return;
        this.setData({
          deliveryCompany: deliveryCompanyList[indexes[0]],
        });
      });
    }).catch((error) => {
      Toast({
        context: this,
        selector: '#t-toast',
        message: getCloudErrorMessage(error, '物流公司加载失败，请稍后重试'),
        icon: '',
      });
    });
  },

  checkParams() {
    const res = { errMsg: '', require: false };

    if (!this.data.trackingNo) {
      res.errMsg = '请填写运单号';
      res.require = true;
    } else if (!this.data.deliveryCompany) {
      res.errMsg = '请选择物流公司';
      res.require = true;
    }
    this.setData({ submitActived: !res.require });
    return res;
  },

  onSubmit() {
    if (this.data.submitting || this.trackingSubmitPromise) return;
    if (this.trackingSubmitBlockedUntil && Date.now() < this.trackingSubmitBlockedUntil) return;
    const checkRes = this.checkParams();
    if (checkRes.errMsg) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: checkRes.errMsg,
        icon: '',
      });
      return;
    }

    const {
      trackingNo,
      remark,
      deliveryCompany: { code, name },
    } = this.data;

    this.trackingSubmitBlockedUntil = Date.now() + 2000;
    const params = {
      rightsNo: this.rightsNo,
      afterSaleId: this.rightsNo,
      trackingNo: String(trackingNo).trim(),
      logisticsCompanyCode: code,
      logisticsCompanyName: name,
      logisticsNo: trackingNo,
      remark,
    };
    const api = this.isChange ? update : create;
    this.setData({ submitting: true });
    this.trackingSubmitPromise = api(params)
      .then(() => {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '保存成功',
          icon: '',
        });
        setTimeout(() => wx.navigateBack({ backRefresh: true }), 1000);
      })
      .catch((error) => {
        this.trackingSubmitBlockedUntil = Date.now() + 1000;
        this.setData({ submitting: false });
        Toast({
          context: this,
          selector: '#t-toast',
          message: getCloudErrorMessage(error, '物流信息保存失败，请稍后重试'),
          icon: '',
        });
      }).finally(() => {
        this.trackingSubmitPromise = null;
      });
    return this.trackingSubmitPromise;
  },

  onScanTap() {
    wx.scanCode({
      scanType: ['barCode'],
      success: (res) => {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '扫码成功',
          icon: '',
        });
        this.setData({ trackingNo: res.result });
      },
      fail: () => {},
    });
  },
});
