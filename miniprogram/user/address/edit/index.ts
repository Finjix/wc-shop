// @ts-nocheck

import Toast from '../../../common/ui/toast';
import { fetchDeliveryAddress, persistAddress } from '../../services/address/fetchAddress';

const innerPhoneReg = '^1(?:3\\d|4[4-9]|5[0-35-9]|6[67]|7[0-8]|8\\d|9\\d)\\d{8}$';
const innerNameReg = '^[a-zA-Z\\d\\u4e00-\\u9fa5]+$';

Page({
  options: {
    multipleSlots: true,
  },
  externalClasses: ['theme-wrapper-class'],
  data: {
    locationState: {
      addressId: '',
      addressTag: '',
      cityCode: '',
      cityName: '',
      countryCode: '',
      countryName: '',
      detailAddress: '',
      districtCode: '',
      districtName: '',
      isDefault: false,
      name: '',
      phone: '',
      provinceCode: '',
      provinceName: '',
      isEdit: false,
      isOrderDetail: false,
      isOrderSure: false,
    },
    submitActive: false,
  },
  privateData: {
    verifyTips: '',
  },
  onLoad(options) {
    const { id } = options;
    const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (eventChannel && eventChannel.on) {
      eventChannel.on('onWeixinAddressPassed', (params) => {
        this.applyLocationState(params);
      });
    }
    this.init(id);
  },

  onUnload() {
    if (!this.hasSaved) {
      getApp().addressSelection.rejectAddress();
    }
  },

  hasSaved: false,

  init(id) {
    if (id) {
      this.getAddressDetail(id);
    }
  },
  getAddressDetail(id) {
    return fetchDeliveryAddress(id).then((detail) => {
      if (!detail) {
        Toast({ context: this, selector: '#t-toast', message: '地址不存在，请重新添加', icon: '' });
        return;
      }
      this.applyLocationState(detail);
    });
  },
  applyLocationState(params = {}) {
    const fullAddress = [params.provinceName || params.province, params.cityName || params.city,
      params.districtName || params.district, params.detailAddress || params.detail].filter(Boolean).join('');
    const locationState = {
      ...this.data.locationState,
      ...params,
      detailAddress: fullAddress,
      provinceName: '', provinceCode: '', cityName: '', cityCode: '', districtName: '', districtCode: '',

      addressId: params.addressId || params.id || params._id || '',
      isDefault: params.isDefault === true || params.isDefault === 'true' || Number(params.isDefault) === 1,
      isEdit: Boolean(params.addressId || params.id || params._id),
    };
    this.setData({ locationState }, () => {
      const { isLegal, tips } = this.onVerifyInputLegal();
      this.setData({ submitActive: isLegal });
      this.privateData.verifyTips = tips;
    });
  },
  onInputValue(e) {
    const { item } = e.currentTarget.dataset;
    const { value = '' } = e.detail;
    this.setData({ [`locationState.${item}`]: value }, () => {
      const { isLegal, tips } = this.onVerifyInputLegal();
      this.setData({ submitActive: isLegal });
      this.privateData.verifyTips = tips;
    });
  },
  onCheckDefaultAddress({ detail }) {
    const { value } = detail;
    this.setData({
      'locationState.isDefault': value,
    });
  },

  onVerifyInputLegal() {
    const { name, phone, detailAddress } = this.data.locationState;
    const prefixPhoneReg = String(this.properties?.phoneReg || innerPhoneReg);
    const prefixNameReg = String(this.properties?.nameReg || innerNameReg);
    const nameRegExp = new RegExp(prefixNameReg);
    const phoneRegExp = new RegExp(prefixPhoneReg);

    if (!name || !name.trim()) {
      return {
        isLegal: false,
        tips: '请填写收货人',
      };
    }
    if (!nameRegExp.test(name)) {
      return {
        isLegal: false,
        tips: '收货人仅支持输入中文、英文（区分大小写）、数字',
      };
    }
    if (!phone || !phone.trim()) {
      return {
        isLegal: false,
        tips: '请填写手机号',
      };
    }
    if (!phoneRegExp.test(phone)) {
      return {
        isLegal: false,
        tips: '请填写正确的手机号',
      };
    }
    if (!detailAddress || !detailAddress.trim()) {
      return {
        isLegal: false,
        tips: '请填写完整地址',
      };
    }
    if (detailAddress && detailAddress.trim().length > 240) {
      return {
        isLegal: false,
        tips: '地址不能超过240个字符',
      };
    }
    return {
      isLegal: true,
      tips: '添加成功',
    };
  },

  formSubmit() {
    if (this.isSaving) return;
    const { isLegal, tips } = this.onVerifyInputLegal();
    this.privateData.verifyTips = tips;
    if (!isLegal) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: tips,
        icon: '',
        duration: 1000,
      });
      return;
    }
    const { locationState } = this.data;

    const address = {
      id: locationState.addressId,
      addressId: locationState.addressId,
      phone: locationState.phone,
      name: locationState.name,
      countryName: locationState.countryName,
      countryCode: locationState.countryCode,
      provinceName: locationState.provinceName,
      provinceCode: locationState.provinceCode,
      cityName: locationState.cityName,
      cityCode: locationState.cityCode,
      districtName: locationState.districtName,
      districtCode: locationState.districtCode,
      detailAddress: locationState.detailAddress.trim(),
      isDefault: locationState.isDefault ? 1 : 0,
      addressTag: locationState.addressTag,
      postalCode: locationState.postalCode,
    };

    this.isSaving = true;
    persistAddress(address).then((savedAddress) => {
      this.hasSaved = true;
      getApp().addressSelection.resolveAddress(savedAddress);
      wx.navigateBack({ delta: 1 });
    }).catch(() => {
      this.hasSaved = false;
      Toast({
        context: this,
        selector: '#t-toast',
        message: '地址保存失败，请稍后重试',
        icon: '',
        duration: 1000,
      });
    }).then(() => {
      this.isSaving = false;
    });
  },

});
// @ts-nocheck
